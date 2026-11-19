import { isUniqueViolation } from "../../errors.ts";
import {
  isSevCreditNoteImportable,
  isSevInvoiceImportable,
  isSevVoucherImportable,
  mapSevCreditNote,
  mapSevInvoice,
  mapSevVoucher,
  SevdeskApiError,
  type SevdeskClient,
  type SevCreditNote,
  type SevFile,
  type SevInvoice,
  type SevOrder,
  type SevMappedVoucher,
  type SevVoucher,
} from "@haben/import";
import { and, desc, eq } from "drizzle-orm";
import { encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { storeLegacyVoucher } from "./legacy-store.ts";
import { latestFastbillImport } from "./fastbill.ts";
import { fallbackName, finish, latestImport, progressMessage, STALE_MS } from "./lexoffice.ts";
import { importOrder, isImportableOrder } from "./orders.ts";
import { createOrderPdfImporter } from "./order-pdfs.ts";
import { importSevdeskArticles } from "./sevdesk-artikel.ts";
import { importSevdeskContacts } from "./sevdesk-kontakte.ts";
import { importSevdeskAccountingTypes } from "./sevdesk-kontoart-abruf.ts";
import { importSevdeskArchiveOnly } from "./sevdesk-nur-archiv.ts";
import { importSevdeskRecurringVouchers } from "./sevdesk-dauerbelege.ts";
import { importSevdeskPayments } from "./sevdesk-payments.ts";
import { checkSevdeskFiles, fetchSevdeskFiles, recordSevdeskFinding } from "./sevdesk-dateien.ts";
import { importSevdeskTemplateFiles } from "./sevdesk-vorlagen-dateien.ts";
import { importSevdeskRecurringInvoices } from "./sevdesk-vorlagen.ts";
import { apiKey, newSevdeskClient, SevdeskError } from "./sevdesk-zugang.ts";

/*
 * Umzug aus sevDesk. Gleicher Ablauf und dieselben Archivtabellen wie beim Lexoffice-Import (Spalte source = "sevdesk"),
 * damit Abgleich, offene Posten, Altbelege und Jahresexport beide Quellen gleich behandeln.
 */

export { SevdeskError, setSevdeskClientFactory, sevdeskClient } from "./sevdesk-zugang.ts";

export async function sevdeskConnectionStatus() {
  const [row] = await db
    .select({ bookkeepingVersion: schema.sevdeskConnection.bookkeepingVersion, createdAt: schema.sevdeskConnection.createdAt })
    .from(schema.sevdeskConnection)
    .where(eq(schema.sevdeskConnection.id, 1));
  return row ?? null;
}

/** Prüft den Token und speichert ihn verschlüsselt. */
export async function saveSevdeskKey(actor: string, key: string): Promise<{ bookkeepingVersion: string }> {
  const trimmed = key.trim();
  if (trimmed.length < 20) throw new SevdeskError("Der API-Token ist zu kurz.");
  let bookkeepingVersion: string;
  try {
    bookkeepingVersion = await newSevdeskClient({ apiKey: trimmed }).bookkeepingSystemVersion();
  } catch (error) {
    throw new SevdeskError(`sevDesk lehnt den Token ab: ${progressMessage(error)}`);
  }
  await withActor(actor, async (tx) => {
    await tx.delete(schema.sevdeskConnection).where(eq(schema.sevdeskConnection.id, 1));
    await tx.insert(schema.sevdeskConnection).values({ id: 1, ciphertext: encrypt(Buffer.from(trimmed, "utf8")), bookkeepingVersion });
  });
  return { bookkeepingVersion };
}

export async function removeSevdeskKey(actor: string) {
  await withActor(actor, (tx) => tx.delete(schema.sevdeskConnection).where(eq(schema.sevdeskConnection.id, 1)));
}

const running = new Map<string, AbortController>();

/** Letzter Abruf aus sevDesk; ein hängengebliebener Lauf (Server neu gestartet) wird als abgebrochen markiert. */
export async function latestSevdeskImport() {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "sevdesk"))
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

/**
 * Startet den Abruf im Hintergrund. Schon übernommene Belege werden übersprungen, ein neuer Lauf setzt
 * also nach einem Abbruch fort. Gibt die ID des Laufs zurück; den Fortschritt liefert latestSevdeskImport().
 */
export async function startSevdeskImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const key = await apiKey();
  // Der eindeutige Index gilt für beide Quellen: auch einen verwaisten Lexoffice-Lauf als abgebrochen markieren
  await latestImport();
  await latestFastbillImport();
  const progress: LexofficeImportProgress = {
    phase: "kontakte",
    contacts: 0,
    contactsLinked: 0,
    listed: 0,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
  };
  const [row] = await withActor(actor, (tx) =>
    tx.insert(schema.lexofficeImports).values({ source: "sevdesk", progress }).returning({ id: schema.lexofficeImports.id }),
  ).catch((error: unknown) => {
    // Der eindeutige Index lässt nur einen laufenden Abruf zu, auch über beide Quellen
    if (isUniqueViolation(error, "lexoffice_imports_one_running")) throw new SevdeskError("Ein Abruf läuft bereits.");
    throw error;
  });
  const id = row!.id;
  const controller = new AbortController();
  running.set(id, controller);
  const client = newSevdeskClient({ apiKey: key, signal: controller.signal });
  const job = runImport(actor, id, client, progress, controller.signal)
    .then(() => finish(id, progress, "fertig", null))
    .catch((error: unknown) =>
      finish(id, progress, controller.signal.aborted ? "abgebrochen" : "fehler", controller.signal.aborted ? "Abgebrochen." : progressMessage(error)),
    )
    // Scheitert auch das Speichern des Abschlusses, darf das keine unbehandelte Ablehnung werden
    .catch((error: unknown) => console.error("sevDesk-Abruf: Abschluss nicht gespeichert", error))
    .finally(() => running.delete(id));
  if (options.wait) await job;
  return id;
}

export function cancelSevdeskImport(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

type Listed =
  | { kind: "invoice"; id: string; number: string; raw: SevInvoice }
  | { kind: "creditnote"; id: string; number: string; raw: SevCreditNote }
  | { kind: "voucher"; id: string; number: string; raw: SevVoucher }
  | { kind: "order"; id: string; number: string; raw: SevOrder };

type Save = (force?: boolean) => Promise<void>;

/** 2. Rechnungen, Gutschriften, Belege und Aufträge zum Übernehmen; dazu alle Rechnungen, auch Entwürfe */
async function listSevdeskDocuments(client: SevdeskClient, progress: LexofficeImportProgress, save: Save, signal: AbortSignal) {
  progress.phase = "liste";
  await save(true);
  const listed: Listed[] = [];
  const add = async (item: Listed) => {
    listed.push(item);
    progress.listed = listed.length;
    await save();
  };
  // Alle Rechnungen, auch Entwürfe: an den aus einer Vorlage erzeugten liest Schritt 6 ab, wie sie abrechnet
  const invoices: SevInvoice[] = [];
  for await (const raw of client.invoices()) {
    invoices.push(raw);
    if (isSevInvoiceImportable(raw)) await add({ kind: "invoice", id: String(raw.id), number: raw.invoiceNumber ?? "", raw });
  }
  for await (const raw of client.creditNotes()) {
    if (isSevCreditNoteImportable(raw)) await add({ kind: "creditnote", id: String(raw.id), number: raw.creditNoteNumber ?? "", raw });
  }
  for await (const raw of client.vouchers()) {
    if (isSevVoucherImportable(raw)) await add({ kind: "voucher", id: String(raw.id), number: raw.description ?? "", raw });
  }
  try {
    for await (const raw of client.orders()) {
      if (isImportableOrder(raw)) await add({ kind: "order", id: String(raw.id), number: raw.orderNumber ?? "", raw });
    }
  } catch (error) {
    if (signal.aborted || (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403))) throw error;
    // Zusätzliche Auftragsdaten dürfen den bisherigen Rechnungs-/Belegimport nicht verhindern.
    progress.failed.push({ lexofficeId: "order", number: "Auftragsdokumente", message: progressMessage(error) });
  }
  return { listed, invoices };
}

/** 3. Je Beleg Positionen und Dateien; Fehler einzelner Belege halten den Lauf nicht auf */
async function importListed(
  actor: string,
  importId: string,
  client: SevdeskClient,
  listed: Listed[],
  done: Set<string>,
  progress: LexofficeImportProgress,
  save: Save,
  signal: AbortSignal,
) {
  const importOrderPdf = createOrderPdfImporter(actor, client, signal);
  progress.phase = "belege";
  await save(true);
  for (const item of listed) {
    const externalId = `${item.kind}/${item.id}`;
    if (done.has(externalId)) {
      progress.skipped += 1;
      continue;
    }
    try {
      // false: ein gleichzeitiger Lauf hat den Beleg schon übernommen
      if (await importVoucher(actor, importId, client, item, progress, signal)) progress.imported += 1;
      else progress.skipped += 1;
      if (item.kind === "order") {
        try {
          if (await importOrderPdf(item.id)) progress.files += 1;
        } catch (error) {
          // Archivkopie steht schon; nur das PDF fehlt. Abbruchgründe gehen an die äußere Behandlung.
          if (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403)) throw error;
          if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
          progress.failed.push({ lexofficeId: externalId, number: item.number, message: `Dokument importiert, PDF fehlt: ${progressMessage(error)}` });
        }
      }
    } catch (error) {
      // Token ungültig oder abgebrochen: weitermachen ist sinnlos
      if (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403)) throw error;
      // Abgebrochen: der Client meldet das als eigenen Fehler, nicht als AbortError
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      progress.failed.push({ lexofficeId: externalId, number: item.number, message: progressMessage(error) });
    }
    await save();
  }
}

async function runImport(actor: string, importId: string, client: SevdeskClient, progress: LexofficeImportProgress, signal: AbortSignal) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  await importSevdeskContacts(actor, client, progress, save);

  // 1b. Artikel (GET /Part) in den Artikelkatalog, verknüpft über die sevDesk-ID
  await importSevdeskArticles(actor, client, progress, signal);

  // 2. Rechnungen, Gutschriften und Belege; Entwürfe und Vorlagen bleiben draußen, Mahnungen und Voranmeldungen folgen nach 3, nur ins Archiv (#472)
  const { listed, invoices } = await listSevdeskDocuments(client, progress, save, signal);
  const done = new Set(
    (await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.source, "sevdesk"))).map(
      (r) => r.id,
    ),
  );

  // 3. Je Beleg Positionen und Dateien
  await importListed(actor, importId, client, listed, done, progress, save, signal);
  await importSevdeskArchiveOnly(actor, importId, client, progress, signal);
  // Die Datei einer Vorlage brauchen Dauerbeleg und Belege aus der Vorlage; sevDesk liefert sie je Lauf nur einmal
  const templateFiles = new Map<string, Promise<SevFile | null>>();
  const templateFile = (documentId: string) => {
    if (!templateFiles.has(documentId)) templateFiles.set(documentId, client.document(documentId));
    return templateFiles.get(documentId)!;
  };
  // 4. Vorlagen wiederkehrender Belege als angehaltene Dauerbelege (#472)
  const knownTemplates = new Set(
    (await db.select({ id: schema.recurringDocuments.sevdeskId }).from(schema.recurringDocuments)).flatMap((r) => (r.id ? [r.id] : [])),
  );
  await importSevdeskRecurringVouchers(actor, client, progress, signal, knownTemplates, templateFile);
  // 5. Datei der Vorlage für Belege aus wiederkehrenden Belegen, auch für früher übernommene (#472)
  // Belege, die sevDesk jetzt mit eigener Datei liefert, auch wenn die Archivkopie aus einem früheren Lauf keine hat
  const withOwnFile = new Set(listed.filter((i) => i.kind === "voucher" && i.raw.document?.id != null && String(i.raw.document.id) !== "").map((i) => i.id));
  await importSevdeskTemplateFiles(actor, client, progress, signal, withOwnFile, templateFile);
  // 5b. Dateistand früherer Belege: fehlende Dateien erneut abrufen, später in sevDesk hochgeladene nachladen, Abrufe vor #345 einordnen
  const listedDocuments = new Map(
    listed
      .filter((i) => i.kind === "voucher")
      .map((i) => [i.id, i.raw.document?.id == null || String(i.raw.document.id) === "" ? null : String(i.raw.document.id)]),
  );
  await checkSevdeskFiles(actor, importId, client, progress, signal, listedDocuments);
  await save(true);
  // 6. Einzelzahlungen, auch für schon früher übernommene Belege (#343)
  await importSevdeskPayments(actor, importId, client, progress, signal);
  // 7. Kontostamm der Buchungskonten von Gutschriften, ebenso für früher übernommene (#472)
  await importSevdeskAccountingTypes(actor, importId, client, progress, signal);
  // 8. Vorlagen wiederkehrender Rechnungen, pausiert (#472)
  await importSevdeskRecurringInvoices(actor, importId, client, invoices, progress, signal);
  await save(true);
}

async function importVoucher(
  actor: string,
  importId: string,
  client: SevdeskClient,
  item: Listed,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<boolean> {
  if (item.kind === "order") return importOrder(actor, importId, client, item.raw);
  let mapped: SevMappedVoucher;
  let positions: unknown[];
  if (item.kind === "invoice") {
    const pos = await client.invoicePositions(item.id);
    [positions, mapped] = [pos, mapSevInvoice(item.raw, pos)];
  } else if (item.kind === "creditnote") {
    const pos = await client.creditNotePositions(item.id);
    [positions, mapped] = [pos, mapSevCreditNote(item.raw, pos)];
  } else {
    const pos = await client.voucherPositions(item.id);
    [positions, mapped] = [pos, mapSevVoucher(item.raw, pos)];
  }
  // Dateien und ihr Stand (#345): Rechnung und Gutschrift brauchen ihr PDF, ein Beleg genau die Datei aus `document`
  const { files, finding } = await fetchSevdeskFiles(client, item.kind, item.id, item.raw, signal);
  const { voucher, payment } = mapped;

  return withActor(actor, async (tx) => {
    const [contact] = voucher.contactLexofficeId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.sevdeskId, voucher.contactLexofficeId))
      : [];
    const row = await storeLegacyVoucher(
      tx,
      {
        lexofficeId: voucher.lexofficeId,
        source: "sevdesk",
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
        // sevDesk nennt je Position nur die ID des Kontos, keinen Namen
        categories: voucher.categories.map((c) => ({ ...c, name: "" })),
        payment,
        remark: voucher.remark,
        raw: { ...(item.raw as Record<string, unknown>), positions },
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
    await recordSevdeskFinding(tx, row.id, finding, actor, importId);
    progress.files += row.files;
    return true;
  });
}
