import { isUniqueViolation, UserError } from "../../errors.ts";
import {
  firstByContact,
  isSevCreditNoteImportable,
  isSevInvoiceImportable,
  isSevMainContact,
  isSevVoucherImportable,
  mapSevContact,
  mapSevCreditNote,
  mapSevInvoice,
  mapSevVoucher,
  SevdeskApiError,
  SevdeskClient,
  type SevCommunicationWay,
  type SevContactAddress,
  type SevCreditNote,
  type SevdeskClientOptions,
  type SevFile,
  type SevInvoice,
  type SevOrder,
  type SevMappedVoucher,
  type SevVoucher,
} from "@haben/import";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { env } from "../../env.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { storeLegacyVoucher } from "./legacy-store.ts";
import { fallbackName, finish, latestImport, progressMessage, STALE_MS } from "./lexoffice.ts";
import { importOrder, isImportableOrder } from "./orders.ts";
import { createOrderPdfImporter } from "./order-pdfs.ts";
import { importSevdeskPayments } from "./sevdesk-payments.ts";

/*
 * Umzug aus sevDesk. Gleicher Ablauf und dieselben Archivtabellen wie beim Lexoffice-Import (Spalte source = "sevdesk"),
 * damit Abgleich, offene Posten, Altbelege und Jahresexport beide Quellen gleich behandeln.
 */

export class SevdeskError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: SevdeskClientOptions) => new SevdeskClient({ baseUrl: env().SEVDESK_API_URL || undefined, ...options });

export function setSevdeskClientFactory(factory: (options: SevdeskClientOptions) => SevdeskClient) {
  clientFactory = factory;
}

async function apiKey(): Promise<string | null> {
  const [row] = await db.select().from(schema.sevdeskConnection).where(eq(schema.sevdeskConnection.id, 1));
  return row ? decrypt(row.ciphertext).toString("utf8") : null;
}

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
    bookkeepingVersion = await clientFactory({ apiKey: trimmed }).bookkeepingSystemVersion();
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
  if (!key) throw new SevdeskError("Zuerst den API-Token hinterlegen.");
  // Der eindeutige Index gilt für beide Quellen: auch einen verwaisten Lexoffice-Lauf als abgebrochen markieren
  await latestImport();
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
  const client = clientFactory({ apiKey: key, signal: controller.signal });
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

async function runImport(actor: string, importId: string, client: SevdeskClient, progress: LexofficeImportProgress, signal: AbortSignal) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  // 1. Kontakte mit erster Adresse und Haupt-E-Mail; eindeutige Rollen auch im Bestand ergänzen
  const addresses: SevContactAddress[] = [];
  for await (const a of client.contactAddresses()) addresses.push(a);
  const mails: SevCommunicationWay[] = [];
  for await (const m of client.emailAddresses()) mails.push(m);
  const addressBy = firstByContact(addresses);
  const mailBy = firstByContact(mails);
  for await (const raw of client.contacts()) {
    if (!isSevMainContact(raw)) continue;
    const contact = mapSevContact(raw, addressBy.get(String(raw.id)), mailBy.get(String(raw.id)));
    const confirmedRole = contact.role === "supplier" ? { isSupplier: true } : contact.role === "customer" ? { isCustomer: true } : {};
    await withActor(actor, async (tx) => {
      const [known] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.sevdeskId, contact.sevdeskId));
      if (known) {
        // Ohne Herkunft je Rollenfeld lässt sich eine zweite Rolle nicht sicher als Importfehler erkennen.
        if (contact.role) {
          const roleColumn = contact.role === "supplier" ? schema.contacts.isSupplier : schema.contacts.isCustomer;
          await tx
            .update(schema.contacts)
            .set(confirmedRole)
            .where(and(eq(schema.contacts.id, known.id), eq(roleColumn, false)));
        }
        return;
      }
      const [sameName] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(isNull(schema.contacts.sevdeskId), sql`lower(${schema.contacts.name}) = lower(${contact.name})`))
        .limit(1);
      if (sameName) {
        await tx
          .update(schema.contacts)
          .set({ sevdeskId: contact.sevdeskId, ...confirmedRole })
          .where(eq(schema.contacts.id, sameName.id));
        progress.contactsLinked += 1;
        return;
      }
      await tx.insert(schema.contacts).values({
        sevdeskId: contact.sevdeskId,
        // Haben braucht eine Rolle; unklare Kategorien erhalten nur bei Neuanlage die bisherige Kunden-Ausgangsrolle.
        isCustomer: contact.role !== "supplier",
        isSupplier: contact.role === "supplier",
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

  // 2. Rechnungen, Gutschriften und Belege; Entwürfe, Vorlagen und Mahnungen bleiben draußen
  progress.phase = "liste";
  await save(true);
  const listed: Listed[] = [];
  const add = async (item: Listed) => {
    listed.push(item);
    progress.listed = listed.length;
    await save();
  };
  for await (const raw of client.invoices()) {
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
  const done = new Set(
    (await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.source, "sevdesk"))).map(
      (r) => r.id,
    ),
  );

  // 3. Je Beleg Positionen und Dateien; Fehler einzelner Belege halten den Lauf nicht auf
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
      if (await importVoucher(actor, importId, client, item, progress)) progress.imported += 1;
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
  // 4. Einzelzahlungen, auch für schon früher übernommene Belege (#343)
  await importSevdeskPayments(actor, importId, client, progress, signal);
  await save(true);
}

async function importVoucher(actor: string, importId: string, client: SevdeskClient, item: Listed, progress: LexofficeImportProgress): Promise<boolean> {
  if (item.kind === "order") return importOrder(actor, importId, client, item.raw);
  let mapped: SevMappedVoucher;
  let positions: unknown[];
  const files: { role: "pdf" | "xml" | "anhang"; fileId: string | null; file: SevFile }[] = [];
  if (item.kind === "invoice") {
    const pos = await client.invoicePositions(item.id);
    positions = pos;
    mapped = mapSevInvoice(item.raw, pos);
    const pdf = await client.invoicePdf(item.id);
    if (pdf) files.push({ role: "pdf", fileId: null, file: pdf });
    const xml = await client.invoiceXml(item.id);
    if (xml) files.push({ role: "xml", fileId: null, file: xml });
  } else if (item.kind === "creditnote") {
    const pos = await client.creditNotePositions(item.id);
    positions = pos;
    mapped = mapSevCreditNote(item.raw, pos);
    const pdf = await client.creditNotePdf(item.id);
    if (pdf) files.push({ role: "pdf", fileId: null, file: pdf });
  } else {
    const pos = await client.voucherPositions(item.id);
    positions = pos;
    mapped = mapSevVoucher(item.raw, pos);
    for (const fileId of mapped.voucher.fileIds) {
      const file = await client.document(fileId);
      if (file) files.push({ role: "anhang", fileId, file });
    }
  }
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
    progress.files += row.files;
    return true;
  });
}
