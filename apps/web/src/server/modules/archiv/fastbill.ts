import {
  FastbillApiError,
  FastbillClient,
  type FastbillClientOptions,
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
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { env } from "../../env.ts";
import { isUniqueViolation, UserError } from "../../errors.ts";
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
 */

export class FastbillError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: FastbillClientOptions) => new FastbillClient({ url: env().FASTBILL_API_URL || undefined, ...options });

export function setFastbillClientFactory(factory: (options: FastbillClientOptions) => FastbillClient) {
  clientFactory = factory;
}

/** Stundengrenzen der Tarife laut API-Doku (https://apidocs.fastbill.com/fastbill/en/fundamentals.html) */
export const FASTBILL_PLANS = [
  { callsPerHour: 50, label: "Solo" },
  { callsPerHour: 100, label: "Solo-Plus" },
  { callsPerHour: 500, label: "Pro" },
  { callsPerHour: 1000, label: "Premium" },
] as const;

async function credentials(): Promise<{ email: string; apiKey: string; callsPerHour: number } | null> {
  const [row] = await db.select().from(schema.fastbillConnection).where(eq(schema.fastbillConnection.id, 1));
  return row ? { email: row.email, apiKey: decrypt(row.ciphertext).toString("utf8"), callsPerHour: row.callsPerHour } : null;
}

export async function fastbillConnectionStatus() {
  const [row] = await db
    .select({ email: schema.fastbillConnection.email, callsPerHour: schema.fastbillConnection.callsPerHour, createdAt: schema.fastbillConnection.createdAt })
    .from(schema.fastbillConnection)
    .where(eq(schema.fastbillConnection.id, 1));
  return row ?? null;
}

/** Prüft E-Mail und Schlüssel mit einem Aufruf und speichert den Schlüssel verschlüsselt. */
export async function saveFastbillKey(actor: string, input: { email: string; apiKey: string; callsPerHour: number }): Promise<{ email: string }> {
  const email = input.email.trim();
  const apiKey = input.apiKey.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new FastbillError("Die Login-E-Mail von FastBill fehlt oder ist ungültig.");
  if (apiKey.length < 20) throw new FastbillError("Der API-Schlüssel ist zu kurz.");
  if (!FASTBILL_PLANS.some((p) => p.callsPerHour === input.callsPerHour)) throw new FastbillError("Unbekannter Tarif.");
  try {
    await clientFactory({ email, apiKey, callsPerHour: input.callsPerHour }).verify();
  } catch (error) {
    throw new FastbillError(`FastBill lehnt die Anmeldung ab: ${progressMessage(error)}`);
  }
  await withActor(actor, async (tx) => {
    await tx.delete(schema.fastbillConnection).where(eq(schema.fastbillConnection.id, 1));
    await tx.insert(schema.fastbillConnection).values({ id: 1, email, ciphertext: encrypt(Buffer.from(apiKey, "utf8")), callsPerHour: input.callsPerHour });
  });
  return { email };
}

export async function removeFastbillKey(actor: string) {
  await withActor(actor, (tx) => tx.delete(schema.fastbillConnection).where(eq(schema.fastbillConnection.id, 1)));
}

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
  const login = await credentials();
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
  const client = clientFactory({
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

type Listed = { kind: "invoice"; id: string; number: string; raw: FbInvoice } | { kind: "expense"; id: string; number: string; raw: FbExpense };

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new FastbillError("Abgebrochen.");
}

function stopsRun(error: unknown, signal: AbortSignal): boolean {
  // Zugang ungültig oder abgebrochen: weitermachen ist sinnlos. Der Client meldet einen Abbruch als eigenen Fehler.
  if (error instanceof FastbillApiError && (error.status === 401 || error.status === 403) && error.service !== "document") return true;
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function runImport(actor: string, importId: string, client: FastbillClient, progress: LexofficeImportProgress, signal: AbortSignal) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    progress.fastbillCalls = client.recentCalls();
    if (progress.waitingUntil && Date.parse(progress.waitingUntil) <= Date.now()) progress.waitingUntil = null;
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  // 1. Kunden; FastBill führt keine Lieferanten als Kontakte
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
      await tx.insert(schema.contacts).values({
        fastbillId: contact.fastbillId,
        isCustomer: true,
        isSupplier: false,
        kundennummer: contact.kundennummer,
        name: contact.name,
        strasse: contact.strasse,
        plz: contact.plz,
        ort: contact.ort,
        land: contact.land,
        email: contact.email,
        ustId: contact.ustId,
      });
      progress.contacts += 1;
    });
    await save();
  }

  // 2. Rechnungen, Gutschriften und Stornos ohne Entwürfe, dazu die Ausgaben
  checkAborted(signal);
  progress.phase = "liste";
  await save(true);
  const listed: Listed[] = [];
  const invoicesById = new Map<string, FbInvoice>();
  const add = async (item: Listed) => {
    listed.push(item);
    progress.listed = listed.length;
    await save();
  };
  for await (const raw of client.invoices()) {
    invoicesById.set(String(raw.INVOICE_ID), raw);
    if (isFbInvoiceImportable(raw)) await add({ kind: "invoice", id: String(raw.INVOICE_ID), number: String(raw.INVOICE_NUMBER ?? ""), raw });
  }
  for await (const raw of client.expenses()) {
    await add({ kind: "expense", id: String(raw.INVOICE_ID), number: String(raw.INVOICE_NUMBER ?? ""), raw });
  }
  const done = new Set(
    (await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.source, "fastbill"))).map(
      (r) => r.id,
    ),
  );

  // 3. Je Beleg das PDF; Fehler einzelner Belege halten den Lauf nicht auf
  checkAborted(signal);
  progress.phase = "belege";
  await save(true);
  for (const item of listed) {
    // Auch wenn nur übersprungen wird: ein Abbruch soll als abgebrochen enden, nicht als fertig
    checkAborted(signal);
    const externalId = `fastbill/${item.kind}/${item.id}`;
    if (done.has(externalId)) {
      progress.skipped += 1;
      continue;
    }
    try {
      // false: ein gleichzeitiger Lauf hat den Beleg schon übernommen
      if (await importVoucher(actor, importId, client, item, invoicesById, progress)) progress.imported += 1;
      else progress.skipped += 1;
    } catch (error) {
      if (stopsRun(error, signal)) throw error;
      progress.failed.push({ lexofficeId: externalId, number: item.number, message: progressMessage(error) });
    }
    await save();
  }
  await save(true);
}

async function importVoucher(
  actor: string,
  importId: string,
  client: FastbillClient,
  item: Listed,
  invoicesById: Map<string, FbInvoice>,
  progress: LexofficeImportProgress,
): Promise<boolean> {
  let mapped: FbMappedVoucher;
  if (item.kind === "invoice") {
    const referenced = item.raw.REFERENCED_INVOICE_ID == null ? undefined : invoicesById.get(String(item.raw.REFERENCED_INVOICE_ID));
    mapped = mapFbInvoice(item.raw, referenced);
  } else {
    mapped = mapFbExpense(item.raw);
  }
  const { voucher, payment } = mapped;

  // Rechnungen haben ihr PDF immer; bei Ausgaben ohne hochgeladenen Beleg liefert FastBill eine leere Antwort (null)
  const files: { role: "pdf" | "anhang"; fileId: string | null; file: FbFile }[] = [];
  const documentUrl = item.raw.DOCUMENT_URL?.trim();
  if (documentUrl) {
    try {
      const file = await client.document(documentUrl);
      if (file) files.push({ role: item.kind === "invoice" ? "pdf" : "anhang", fileId: item.kind === "expense" ? voucher.lexofficeId : null, file });
    } catch (error) {
      if (error instanceof FastbillApiError && error.service === "document" && error.status === 0 && /DOCUMENT_URL/.test(error.message)) {
        // Adresse außerhalb von FastBill: Beleg ohne Datei übernehmen, der Abgleich zeigt sie als fehlend
        progress.failed.push({ lexofficeId: voucher.lexofficeId, number: item.number, message: `Beleg übernommen, PDF fehlt: ${error.message}` });
      } else throw error;
    }
  }

  return withActor(actor, async (tx) => {
    const [contact] = voucher.contactLexofficeId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.fastbillId, voucher.contactLexofficeId))
      : [];
    const row = await storeLegacyVoucher(
      tx,
      {
        lexofficeId: voucher.lexofficeId,
        source: "fastbill",
        importId,
        type: voucher.type,
        direction: voucher.direction,
        number: voucher.number,
        date: voucher.date,
        dueDate: voucher.dueDate,
        serviceFrom: voucher.serviceFrom,
        serviceTo: voucher.serviceTo,
        status: voucher.status,
        contactId: contact?.id ?? null,
        contactName: voucher.contactName,
        currency: voucher.currency,
        net: voucher.net,
        tax: voucher.tax,
        gross: voucher.gross,
        taxes: voucher.taxes,
        // FastBill nennt nur den Namen der Kategorie; er steht als ID und Name
        categories: voucher.categories.map((c) => ({ ...c, name: c.categoryId })),
        payment,
        remark: voucher.remark,
        raw: item.raw as Record<string, unknown>,
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
    return true;
  });
}
