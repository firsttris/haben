import {
  FastbillApiError,
  type FastbillClient,
  type FbExpense,
  type FbFile,
  type FbInvoice,
  type FbMappedVoucher,
  isFbInvoiceImportable,
  mapFbCustomer,
  mapFbExpense,
  mapFbInvoice,
} from "@haben/import";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { isUniqueViolation } from "../../errors.ts";
import { waitingReceipt } from "./fastbill-belege.ts";
import { FastbillError, fastbillCredentials, newFastbillClient } from "./fastbill-zugang.ts";
import { storeLegacyVoucher } from "./legacy-store.ts";
import { fallbackName, finish, latestImport, progressMessage, STALE_MS } from "./lexoffice.ts";
import { latestSevdeskImport } from "./sevdesk.ts";

/*
 * Umzug aus FastBill. Gleicher Ablauf und dieselben Archivtabellen wie beim sevDesk-Import (Spalte source = "fastbill"),
 * damit Abgleich, offene Posten, Altbelege und Jahresexport alle Quellen gleich behandeln.
 *
 * Anders als sevDesk begrenzt FastBill die API-Aufrufe je Stunde nach Tarif (Solo 50). Der Client wartet an der Grenze;
 * die Startzeiten der Aufrufe stehen im Fortschritt, damit ein neuer Lauf nach einem Abbruch die Grenze weiter einhält.
 * Ein Lauf mit vielen Belegen kann so Stunden dauern. PDFs hinter DOCUMENT_URL zählen nicht auf die Grenze.
 *
 * Zugang und Tarif stehen in fastbill-zugang.ts, die Belege, die FastBill nur im Browser herausgibt, in fastbill-belege.ts.
 */

export {
  FASTBILL_PLANS,
  FastbillError,
  fastbillConnectionStatus,
  removeFastbillKey,
  saveFastbillKey,
  setFastbillClientFactory,
} from "./fastbill-zugang.ts";
export {
  FASTBILL_RECEIPTS_FORMAT,
  type FastbillReceiptUpload,
  fastbillReceiptScriptList,
  fastbillReceiptsOverview,
  markFastbillWithoutReceipt,
  uploadFastbillReceipts,
} from "./fastbill-belege.ts";

const running = new Map<string, AbortController>();

/** Letzter Abruf aus FastBill; ein hängengebliebener Lauf (Server neu gestartet) wird als abgebrochen markiert. */
export async function latestFastbillImport() {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "fastbill"))
    .orderBy(desc(schema.lexofficeImports.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "laeuft" && !running.has(row.id) && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    const [updated] = await db
      .update(schema.lexofficeImports)
      .set({ status: "abgebrochen", error: "Der Abruf wurde unterbrochen. Ein neuer Abruf setzt dort fort.", finishedAt: new Date() })
      .where(and(eq(schema.lexofficeImports.id, row.id), eq(schema.lexofficeImports.status, "laeuft")))
      .returning();
    return updated ?? row;
  }
  return row;
}

/** Aufrufe der letzten Stunde aus dem letzten Lauf, damit ein Neustart nicht sofort über die Stundengrenze geht */
async function previousCalls(): Promise<number[]> {
  const last = await latestFastbillImport();
  return last?.progress.fastbillCalls ?? [];
}

/**
 * Startet den Abruf im Hintergrund. Schon übernommene Belege werden übersprungen, ein neuer Lauf setzt also nach einem
 * Abbruch fort. Gibt die ID des Laufs zurück; den Fortschritt liefert latestFastbillImport().
 */
export async function startFastbillImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const login = await fastbillCredentials();
  if (!login) throw new FastbillError("Zuerst Login-E-Mail und API-Schlüssel hinterlegen.");
  const calls = await previousCalls();
  // Der eindeutige Index gilt für alle Quellen: auch verwaiste Läufe aus Lexoffice und sevDesk als abgebrochen markieren
  await latestImport();
  await latestSevdeskImport();
  const progress: LexofficeImportProgress = {
    phase: "kontakte",
    contacts: 0,
    contactsLinked: 0,
    listed: 0,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
    fastbillCalls: calls,
    waitingUntil: null,
    fastbillWaiting: 0,
  };
  const [row] = await withActor(actor, (tx) =>
    tx.insert(schema.lexofficeImports).values({ source: "fastbill", progress }).returning({ id: schema.lexofficeImports.id }),
  ).catch((error: unknown) => {
    if (isUniqueViolation(error, "lexoffice_imports_one_running")) throw new FastbillError("Ein Abruf läuft bereits.");
    throw error;
  });
  const id = row!.id;
  const controller = new AbortController();
  running.set(id, controller);
  const client = newFastbillClient({
    email: login.email,
    apiKey: login.apiKey,
    callsPerHour: login.callsPerHour,
    previousCalls: calls,
    signal: controller.signal,
    onRateLimitWait: (ms) => {
      progress.waitingUntil = new Date(Date.now() + ms).toISOString();
      void db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, id));
    },
  });
  const job = runImport(actor, id, client, progress, controller.signal)
    .then(() => finish(id, withCalls(progress, client), "fertig", null))
    .catch((error: unknown) =>
      finish(
        id,
        withCalls(progress, client),
        controller.signal.aborted ? "abgebrochen" : "fehler",
        controller.signal.aborted ? "Abgebrochen." : progressMessage(error),
      ),
    )
    // Scheitert auch das Speichern des Abschlusses, darf das keine unbehandelte Ablehnung werden
    .catch((error: unknown) => console.error("FastBill-Abruf: Abschluss nicht gespeichert", error))
    .finally(() => running.delete(id));
  if (options.wait) await job;
  return id;
}

function withCalls(progress: LexofficeImportProgress, client: FastbillClient): LexofficeImportProgress {
  progress.fastbillCalls = client.recentCalls();
  progress.waitingUntil = null;
  return progress;
}

export function cancelFastbillImport(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Alle abgerufenen Rechnungen je ID und die Gutschriften je Rechnung, auf die sie verweisen */
type InvoiceIndex = { invoicesById: Map<string, FbInvoice>; creditsByInvoice: Map<string, FbInvoice[]> };

type Listed = { kind: "invoice"; id: string; number: string; raw: FbInvoice } | { kind: "expense"; id: string; number: string; raw: FbExpense };

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new FastbillError("Abgebrochen.");
}

function stopsRun(error: unknown, signal: AbortSignal): boolean {
  // Zugang ungültig oder abgebrochen: weitermachen ist sinnlos. Der Client meldet einen Abbruch als eigenen Fehler.
  if (error instanceof FastbillApiError && (error.status === 401 || error.status === 403) && error.service !== "document") return true;
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

type Save = (force?: boolean) => Promise<void>;

async function runImport(actor: string, importId: string, client: FastbillClient, progress: LexofficeImportProgress, signal: AbortSignal) {
  let lastSave = 0;
  const save: Save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    progress.fastbillCalls = client.recentCalls();
    if (progress.waitingUntil && Date.parse(progress.waitingUntil) <= Date.now()) progress.waitingUntil = null;
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  await importCustomers(actor, client, progress, save);
  checkAborted(signal);
  progress.phase = "liste";
  await save(true);
  const { listed, invoicesById, creditsByInvoice } = await listVouchers(client, progress, save);
  checkAborted(signal);
  progress.phase = "belege";
  await save(true);
  await importListed(actor, importId, client, listed, { invoicesById, creditsByInvoice }, progress, save, signal);
  await save(true);
}

/** 1. Kunden; FastBill führt keine Lieferanten als Kontakte */
async function importCustomers(actor: string, client: FastbillClient, progress: LexofficeImportProgress, save: Save) {
  for await (const raw of client.customers()) {
    const contact = mapFbCustomer(raw);
    await withActor(actor, async (tx) => {
      const [known] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.fastbillId, contact.fastbillId));
      if (known) {
        await tx
          .update(schema.contacts)
          .set({ isCustomer: true })
          .where(and(eq(schema.contacts.id, known.id), eq(schema.contacts.isCustomer, false)));
        return;
      }
      const [sameName] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(isNull(schema.contacts.fastbillId), sql`lower(${schema.contacts.name}) = lower(${contact.name})`))
        .limit(1);
      if (sameName) {
        await tx.update(schema.contacts).set({ fastbillId: contact.fastbillId, isCustomer: true }).where(eq(schema.contacts.id, sameName.id));
        progress.contactsLinked += 1;
        return;
      }
      const { fastbillId, kundennummer, name, strasse, plz, ort, land, email, ustId } = contact;
      await tx.insert(schema.contacts).values({ fastbillId, isCustomer: true, isSupplier: false, kundennummer, name, strasse, plz, ort, land, email, ustId });
      progress.contacts += 1;
    });
    await save();
  }
}

/** 2. Rechnungen, Gutschriften und Stornos ohne Entwürfe, dazu die Ausgaben; alle Rechnungen je ID für die Stornos */
async function listVouchers(client: FastbillClient, progress: LexofficeImportProgress, save: Save) {
  const listed: Listed[] = [];
  const invoicesById = new Map<string, FbInvoice>();
  /** Gutschriften je Rechnung, auf die sie verweisen: unterscheiden Storno und Teilstorno */
  const creditsByInvoice = new Map<string, FbInvoice[]>();
  const add = async (item: Listed) => {
    listed.push(item);
    progress.listed = listed.length;
    await save();
  };
  for await (const raw of client.invoices()) {
    invoicesById.set(String(raw.INVOICE_ID), raw);
    const ref = raw.REFERENCED_INVOICE_ID == null ? "" : String(raw.REFERENCED_INVOICE_ID);
    if (ref && String(raw.TYPE ?? "").toLowerCase() === "credit") creditsByInvoice.set(ref, [...(creditsByInvoice.get(ref) ?? []), raw]);
    if (isFbInvoiceImportable(raw)) await add({ kind: "invoice", id: String(raw.INVOICE_ID), number: String(raw.INVOICE_NUMBER ?? ""), raw });
  }
  for await (const raw of client.expenses()) {
    await add({ kind: "expense", id: String(raw.INVOICE_ID), number: String(raw.INVOICE_NUMBER ?? ""), raw });
  }
  return { listed, invoicesById, creditsByInvoice };
}

/** 3. Je Beleg das PDF; Fehler einzelner Belege halten den Lauf nicht auf */
async function importListed(
  actor: string,
  importId: string,
  client: FastbillClient,
  listed: Listed[],
  invoices: InvoiceIndex,
  progress: LexofficeImportProgress,
  save: Save,
  signal: AbortSignal,
) {
  const done = new Set(
    (await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.source, "fastbill"))).map(
      (r) => r.id,
    ),
  );
  for (const item of listed) {
    // Auch wenn nur übersprungen wird: ein Abbruch soll als abgebrochen enden, nicht als fertig
    checkAborted(signal);
    const externalId = `fastbill/${item.kind}/${item.id}`;
    if (done.has(externalId)) {
      progress.skipped += 1;
      continue;
    }
    try {
      // übersprungen: ein gleichzeitiger Lauf hat den Beleg schon übernommen; wartet: Ausgabe ohne Datei, siehe fastbill_receipts
      const outcome = await importVoucher(actor, importId, client, item, invoices, progress);
      if (outcome === "uebernommen") progress.imported += 1;
      else if (outcome === "wartet") progress.fastbillWaiting = (progress.fastbillWaiting ?? 0) + 1;
      else progress.skipped += 1;
    } catch (error) {
      if (stopsRun(error, signal)) throw error;
      progress.failed.push({ lexofficeId: externalId, number: item.number, message: progressMessage(error) });
    }
    await save();
  }
}

/**
 * Antwort der API fürs Archiv ohne DOCUMENT_URL: Der Link trägt einen eigenen Schlüssel und öffnet die Datei ohne Anmeldung;
 * im unveränderlichen Archiv und im Jahresexport (quelle.json) bliebe er für immer stehen. Die Datei selbst liegt im Archiv.
 */
function withoutDocumentUrl(raw: FbInvoice | FbExpense): Record<string, unknown> {
  const { DOCUMENT_URL: _, ...rest } = raw as Record<string, unknown>;
  return rest;
}

type VoucherFile = { role: "pdf" | "anhang"; fileId: string | null; file: FbFile };

async function importVoucher(
  actor: string,
  importId: string,
  client: FastbillClient,
  item: Listed,
  { invoicesById, creditsByInvoice }: InvoiceIndex,
  progress: LexofficeImportProgress,
): Promise<"uebernommen" | "uebersprungen" | "wartet"> {
  let mapped: FbMappedVoucher;
  if (item.kind === "invoice") {
    const referenced = item.raw.REFERENCED_INVOICE_ID == null ? undefined : invoicesById.get(String(item.raw.REFERENCED_INVOICE_ID));
    mapped = mapFbInvoice(item.raw, referenced, creditsByInvoice.get(item.id));
  } else {
    mapped = mapFbExpense(item.raw);
  }
  const files = await voucherFiles(actor, client, item, mapped, progress);
  if (files === "wartet") return "wartet";
  return (await storeVoucher(actor, importId, item, mapped, files, progress)) ? "uebernommen" : "uebersprungen";
}

/**
 * Die Datei eines Belegs: Rechnungen haben ihr PDF immer; bei Ausgaben ohne hochgeladenen Beleg liefert FastBill eine leere
 * Antwort. Gibt FastBill sie nur im angemeldeten Browser heraus, wartet die Ausgabe auf das Browser-Skript oder auf „ohne
 * Beleg übernehmen“ und wird nie stillschweigend ohne Datei archiviert (fastbill-belege.ts).
 */
async function voucherFiles(
  actor: string,
  client: FastbillClient,
  item: Listed,
  { voucher }: FbMappedVoucher,
  progress: LexofficeImportProgress,
): Promise<VoucherFile[] | "wartet"> {
  const documentUrl = item.raw.DOCUMENT_URL?.trim();
  if (!documentUrl) return [];
  let apiFile: FbFile | null = null;
  try {
    apiFile = await client.document(documentUrl);
  } catch (error) {
    if (!(error instanceof FastbillApiError && error.service === "document" && error.status === 0 && /DOCUMENT_URL/.test(error.message))) throw error;
    // Adresse außerhalb von FastBill: Beleg ohne Datei übernehmen, der Abgleich zeigt sie als fehlend
    progress.failed.push({ lexofficeId: voucher.lexofficeId, number: item.number, message: `Beleg übernommen, PDF fehlt: ${error.message}` });
    return [];
  }
  if (apiFile) return [{ role: item.kind === "invoice" ? "pdf" : "anhang", fileId: item.kind === "expense" ? voucher.lexofficeId : null, file: apiFile }];
  if (item.kind !== "expense") return [];
  const receipt = await waitingReceipt(actor, item.id, voucher, documentUrl);
  if (receipt === "wartet") return "wartet";
  return receipt === "ohne_beleg" ? [] : [{ role: "anhang", fileId: voucher.lexofficeId, file: receipt }];
}

/** Archiviert den Beleg samt Dateien; false, wenn ein gleichzeitiger Lauf ihn schon übernommen hat */
async function storeVoucher(
  actor: string,
  importId: string,
  item: Listed,
  { voucher, payment }: FbMappedVoucher,
  files: VoucherFile[],
  progress: LexofficeImportProgress,
): Promise<boolean> {
  return withActor(actor, async (tx) => {
    const [contact] = voucher.contactLexofficeId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.fastbillId, voucher.contactLexofficeId))
      : [];
    const { lexofficeId, type, direction, number, date, dueDate, serviceFrom, serviceTo, status, contactName, currency, net, tax, gross, taxes, remark } =
      voucher;
    const row = await storeLegacyVoucher(
      tx,
      {
        ...{ lexofficeId, type, direction, number, date, dueDate, serviceFrom, serviceTo, status, contactName, currency, net, tax, gross, taxes, remark },
        source: "fastbill",
        importId,
        contactId: contact?.id ?? null,
        // FastBill nennt nur den Namen der Kategorie; er steht als ID und Name
        categories: voucher.categories.map((c) => ({ ...c, name: c.categoryId })),
        payment,
        raw: withoutDocumentUrl(item.raw),
      },
      files.map((entry) => ({
        role: entry.role,
        sourceFileId: entry.fileId,
        filename: entry.file.filename ?? fallbackName(voucher, entry.role, entry.file.bytes),
        mimeType: entry.file.mimeType,
        bytes: entry.file.bytes,
      })),
    );
    if (!row) return false;
    progress.files += row.files;
    // Die Datei hängt jetzt am archivierten Beleg; das Zwischenlager braucht die Zeile nicht mehr
    if (item.kind === "expense") await tx.delete(schema.fastbillReceipts).where(eq(schema.fastbillReceipts.expenseId, item.id));
    return true;
  });
}
