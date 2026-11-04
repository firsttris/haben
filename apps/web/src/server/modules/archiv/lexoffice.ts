import { INTERNAL_ERROR, isUniqueViolation, UserError, userMessage } from "../../errors.ts";
import {
  datevYearSums,
  LexofficeApiError,
  LexofficeClient,
  mapContact,
  mapPayments,
  mapSalesDocument,
  mapVoucher,
  type LegacyVoucher,
  type LexFile,
  readWebExport,
  type LexofficeClientOptions,
  type LexofficeSource,
  webExportSource,
} from "@haben/import";
import {
  LEGACY_PAYMENT_TYPES,
  legacyNeutralKind,
  legacyNeutralSums,
  legacyVatByMonth,
  type LegacyNeutralKind,
  type LegacyNeutralSum,
  type Rechtsform,
  type Versteuerung,
} from "@haben/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { loadCompany } from "../stammdaten/index.ts";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { env } from "../../env.ts";
import { db, schema } from "../../db/index.ts";
import type { LegacyCategoryRow, LegacyPayment, LegacyTaxRow, LexofficeImportProgress } from "../../db/schema.ts";
import { sha256Of, sniff, storeFile } from "../../storage.ts";
import { latestSevdeskImport } from "./sevdesk.ts";

export class LexofficeError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: LexofficeClientOptions) => new LexofficeClient({ baseUrl: env().LEXOFFICE_API_URL || undefined, ...options });

export function setLexofficeClientFactory(factory: (options: LexofficeClientOptions) => LexofficeClient) {
  clientFactory = factory;
}

const SALES_TYPES = ["invoice", "creditnote", "downpaymentinvoice"] as const;
const BOOKKEEPING_TYPES = ["salesinvoice", "salescreditnote", "purchaseinvoice", "purchasecreditnote"] as const;
type SalesType = (typeof SALES_TYPES)[number];

function isSalesType(type: string): type is SalesType {
  return (SALES_TYPES as readonly string[]).includes(type);
}

/** Läuft ein Abruf länger als so lange ohne Fortschritt, gilt er als abgebrochen (Neustart des Servers). */
export const STALE_MS = 3 * 60 * 1000;

export function progressMessage(error: unknown): string {
  const message = userMessage(error);
  if (message === undefined) console.error("Lexoffice-Abruf", error);
  return message ?? INTERNAL_ERROR;
}

async function apiKey(): Promise<string | null> {
  const [row] = await db.select().from(schema.lexofficeConnection).where(eq(schema.lexofficeConnection.id, 1));
  return row ? decrypt(row.ciphertext).toString("utf8") : null;
}

export async function connectionStatus() {
  const [row] = await db
    .select({ organizationName: schema.lexofficeConnection.organizationName, createdAt: schema.lexofficeConnection.createdAt })
    .from(schema.lexofficeConnection)
    .where(eq(schema.lexofficeConnection.id, 1));
  return row ?? null;
}

/** Prüft den Schlüssel gegen /profile und speichert ihn verschlüsselt. */
export async function saveApiKey(actor: string, key: string): Promise<{ organizationName: string }> {
  const trimmed = key.trim();
  if (trimmed.length < 20) throw new LexofficeError("Der API-Schlüssel ist zu kurz.");
  let organizationName: string;
  try {
    const profile = await clientFactory({ apiKey: trimmed }).profile();
    organizationName = profile.companyName ?? "";
  } catch (error) {
    throw new LexofficeError(`Lexware Office lehnt den Schlüssel ab: ${progressMessage(error)}`);
  }
  await withActor(actor, async (tx) => {
    await tx.delete(schema.lexofficeConnection).where(eq(schema.lexofficeConnection.id, 1));
    await tx.insert(schema.lexofficeConnection).values({ id: 1, ciphertext: encrypt(Buffer.from(trimmed, "utf8")), organizationName });
  });
  return { organizationName };
}

export async function removeApiKey(actor: string) {
  await withActor(actor, (tx) => tx.delete(schema.lexofficeConnection).where(eq(schema.lexofficeConnection.id, 1)));
}

/** Letzter Abruf; ein hängengebliebener Lauf (Server neu gestartet) wird als abgebrochen markiert. */
export async function latestImport() {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "lexoffice"))
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

const running = new Map<string, AbortController>();

/**
 * Startet den Abruf über die Public API im Hintergrund. Schon übernommene Belege werden übersprungen, ein neuer Lauf
 * setzt also nach einem Abbruch fort. Gibt die ID des Laufs zurück; den Fortschritt liefert latestImport().
 */
export async function startImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const key = await apiKey();
  if (!key) throw new LexofficeError("Zuerst den API-Schlüssel hinterlegen.");
  return launchImport(actor, (signal) => clientFactory({ apiKey: key, signal }), options);
}

/**
 * Übernimmt eine Sicherung aus der Web-Oberfläche (Skript lexware-sicherung.js, für Tarife ohne Public API).
 * Derselbe Ablauf wie beim Abruf über die API: Kontakte, Belege mit Zahlungen und Dateien; Vorhandenes wird
 * übersprungen, Teile dürfen nacheinander kommen.
 */
export async function startWebImport(actor: string, parts: { name: string; bytes: Uint8Array }[], options: { wait?: boolean } = {}): Promise<string> {
  const source = webExportSource(readWebExport(parts));
  return launchImport(actor, () => source, options);
}

async function launchImport(actor: string, sourceFor: (signal: AbortSignal) => LexofficeSource, options: { wait?: boolean }): Promise<string> {
  const current = await latestImport();
  if (current?.status === "laeuft") throw new LexofficeError("Ein Abruf läuft bereits.");
  // Der eindeutige Index gilt für beide Quellen: auch einen verwaisten sevDesk-Lauf als abgebrochen markieren
  if ((await latestSevdeskImport())?.status === "laeuft") throw new LexofficeError("Ein Abruf aus sevDesk läuft bereits.");
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
  const [row] = await withActor(actor, (tx) => tx.insert(schema.lexofficeImports).values({ progress }).returning({ id: schema.lexofficeImports.id })).catch(
    (error: unknown) => {
      // Gleichzeitig gestartet: der eindeutige Index lässt nur einen laufenden Abruf zu
      if (isUniqueViolation(error, "lexoffice_imports_one_running")) throw new LexofficeError("Ein Abruf läuft bereits.");
      throw error;
    },
  );
  const id = row!.id;
  const controller = new AbortController();
  running.set(id, controller);
  const source = sourceFor(controller.signal);
  const job = runImport(actor, id, source, progress, controller.signal)
    .then(() => finish(id, progress, "fertig", null))
    .catch((error: unknown) =>
      finish(id, progress, controller.signal.aborted ? "abgebrochen" : "fehler", controller.signal.aborted ? "Abgebrochen." : progressMessage(error)),
    )
    // Scheitert auch das Speichern des Abschlusses, darf das keine unbehandelte Ablehnung werden
    .catch((error: unknown) => console.error("Lexware-Office-Abruf: Abschluss nicht gespeichert", error))
    .finally(() => running.delete(id));
  if (options.wait) await job;
  return id;
}

export function cancelImport(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function finish(id: string, progress: LexofficeImportProgress, status: "fertig" | "fehler" | "abgebrochen", error: string | null) {
  progress.phase = "fertig";
  await db
    .update(schema.lexofficeImports)
    .set({ status, error, progress, updatedAt: new Date(), finishedAt: new Date() })
    .where(eq(schema.lexofficeImports.id, id));
}

async function runImport(actor: string, importId: string, client: LexofficeSource, progress: LexofficeImportProgress, signal: AbortSignal) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  // 1. Kontakte: vorhandene über die Lexoffice-ID überspringen, gleichnamige ohne ID verknüpfen
  for await (const raw of client.contacts()) {
    // Die Sicherung aus der Web-Oberfläche liest ohne Netz und kennt das Signal nicht: selbst prüfen
    signal.throwIfAborted();
    const contact = mapContact(raw);
    await withActor(actor, async (tx) => {
      const [known] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.lexofficeId, contact.lexofficeId));
      if (known) return;
      const [sameName] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(isNull(schema.contacts.lexofficeId), sql`lower(${schema.contacts.name}) = lower(${contact.name})`))
        .limit(1);
      if (sameName) {
        // Rollen nur ergänzen: Lieferant in Lexoffice wird auch hier Lieferant, die Kundenrolle bleibt
        await tx
          .update(schema.contacts)
          .set({
            lexofficeId: contact.lexofficeId,
            ...(contact.isVendor
              ? { isSupplier: true, lieferantennummer: sql`coalesce(${schema.contacts.lieferantennummer}, ${contact.lieferantennummer})` }
              : {}),
          })
          .where(eq(schema.contacts.id, sameName.id));
        progress.contactsLinked += 1;
        return;
      }
      await tx.insert(schema.contacts).values({
        lexofficeId: contact.lexofficeId,
        kundennummer: contact.kundennummer,
        // Ohne Rolle in Lexoffice gilt der Kontakt wie bisher als Kunde
        isCustomer: contact.isCustomer || !contact.isVendor,
        isSupplier: contact.isVendor,
        lieferantennummer: contact.lieferantennummer,
        name: contact.name,
        strasse: contact.strasse,
        plz: contact.plz,
        ort: contact.ort,
        land: contact.land,
        email: contact.email,
        ustId: contact.ustId,
        archivedAt: contact.archived ? new Date() : null,
      });
      progress.contacts += 1;
    });
    await save();
  }

  // 2. Belegliste; Entwürfe sind keine Belege und bleiben draußen
  progress.phase = "liste";
  await save(true);
  const categories = new Map((await client.postingCategories()).map((c) => [c.id, c.name]));
  const listed: { id: string; type: string; number: string }[] = [];
  for await (const item of client.voucherList([...SALES_TYPES, ...BOOKKEEPING_TYPES])) {
    if (item.voucherStatus === "draft") continue;
    listed.push({ id: item.id, type: item.voucherType, number: item.voucherNumber ?? "" });
    progress.listed = listed.length;
    await save();
  }
  const done = new Set((await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers)).map((r) => r.id));

  // 3. Je Beleg Details, Zahlungen und Dateien; Fehler einzelner Belege halten den Lauf nicht auf
  progress.phase = "belege";
  await save(true);
  for (const item of listed) {
    signal.throwIfAborted();
    if (done.has(item.id)) {
      progress.skipped += 1;
      continue;
    }
    try {
      // false: ein gleichzeitiger Lauf hat den Beleg schon übernommen
      if (await importVoucher(actor, importId, client, item, categories, progress)) progress.imported += 1;
      else progress.skipped += 1;
    } catch (error) {
      // Schlüssel ungültig, Tarif gewechselt oder abgebrochen: weitermachen ist sinnlos
      if (error instanceof LexofficeApiError && (error.status === 401 || error.status === 403)) throw error;
      // Abgebrochen: der Client meldet das als eigenen Fehler, nicht als AbortError
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      progress.failed.push({ lexofficeId: item.id, number: item.number, message: progressMessage(error) });
    }
    await save();
  }
  await save(true);
}

async function importVoucher(
  actor: string,
  importId: string,
  client: LexofficeSource,
  item: { id: string; type: string },
  categories: Map<string, string>,
  progress: LexofficeImportProgress,
): Promise<boolean> {
  let voucher: LegacyVoucher;
  let raw: unknown;
  const files: { role: "pdf" | "xml" | "anhang"; lexofficeFileId: string | null; file: LexFile }[] = [];
  if (isSalesType(item.type)) {
    raw = await client.salesDocument(item.type, item.id);
    voucher = mapSalesDocument(item.type, raw as Parameters<typeof mapSalesDocument>[1], item.id);
    const pdf = await client.salesDocumentPdf(item.type, item.id);
    if (pdf) files.push({ role: "pdf", lexofficeFileId: null, file: pdf });
    const xml = await client.salesDocumentXml(item.type, item.id);
    if (xml) files.push({ role: "xml", lexofficeFileId: null, file: xml });
  } else {
    raw = await client.voucher(item.id);
    voucher = mapVoucher(raw as Parameters<typeof mapVoucher>[0], item.id);
    for (const fileId of voucher.fileIds) {
      files.push({ role: "anhang", lexofficeFileId: fileId, file: await client.file(fileId) });
    }
  }
  const payments = await client.payments(item.id);

  for (const entry of files) await storeFile(entry.file.bytes);

  return withActor(actor, async (tx) => {
    const [contact] = voucher.contactLexofficeId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.lexofficeId, voucher.contactLexofficeId))
      : [];
    const [row] = await tx
      .insert(schema.lexofficeVouchers)
      .values({
        lexofficeId: voucher.lexofficeId,
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
        categories: voucher.categories.map((c) => ({ ...c, name: categories.get(c.categoryId) ?? "" })),
        payment: payments ? mapPayments(payments) : null,
        remark: voucher.remark,
        raw: raw as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: schema.lexofficeVouchers.lexofficeId })
      .returning({ id: schema.lexofficeVouchers.id });
    if (!row) return false;
    const seen = new Set<string>();
    for (const entry of files) {
      const sha256 = sha256Of(entry.file.bytes);
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      await tx.insert(schema.lexofficeVoucherFiles).values({
        voucherId: row.id,
        role: entry.role,
        lexofficeFileId: entry.lexofficeFileId,
        filename: (entry.file.filename ?? fallbackName(voucher, entry.role, entry.file.bytes)).slice(0, 200),
        mimeType: entry.file.mimeType.split(";")[0]!.trim() || "application/octet-stream",
        sha256,
        size: entry.file.bytes.byteLength,
      });
      progress.files += 1;
    }
    return true;
  });
}

export function fallbackName(voucher: LegacyVoucher, role: "pdf" | "xml" | "anhang", bytes: Uint8Array): string {
  const base = (voucher.number || voucher.lexofficeId).replace(/[^\w.-]+/g, "_");
  const kind = sniff(bytes)?.kind;
  const extension = role === "xml" ? "xml" : kind === "jpeg" ? "jpg" : (kind ?? "pdf");
  return `${base}.${extension}`;
}

// ---------------------------------------------------------------------------------------------
// Archiv: Übersicht und Abgleich

export async function listLegacyVouchers(filter: { year: number; direction: "alle" | "einnahme" | "ausgabe"; search: string; ohneDatei: boolean }) {
  const term = filter.search.trim() ? `%${filter.search.trim()}%` : null;
  const rows = await db.execute<{
    id: string;
    source: "lexoffice" | "sevdesk";
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    status: string;
    contact_name: string;
    net: number;
    tax: number;
    gross: number;
    files: number;
  }>(sql`
    select v.id, v.source, v.type, v.direction, v.number, v.date::text as date, v.status, v.contact_name, v.net, v.tax, v.gross,
      (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files
    from lexoffice_vouchers v
    where v.date between ${`${filter.year}-01-01`} and ${`${filter.year}-12-31`}
      ${filter.direction === "alle" ? sql`` : sql`and v.direction = ${filter.direction}`}
      ${term ? sql`and (v.number ilike ${term} or v.contact_name ilike ${term} or v.remark ilike ${term})` : sql``}
      ${filter.ohneDatei ? sql`and not exists (select 1 from lexoffice_voucher_files f where f.voucher_id = v.id) and not coalesce((v.raw->>'ohneBeleg')::boolean, false)` : sql``}
    order by v.date, v.number
    limit 1000`);
  return [...rows].map((r) => ({
    id: r.id,
    source: r.source,
    type: r.type,
    direction: r.direction,
    number: r.number,
    date: r.date,
    status: r.status,
    contactName: r.contact_name,
    net: Number(r.net),
    tax: Number(r.tax),
    gross: Number(r.gross),
    files: Number(r.files),
  }));
}

export async function legacyVoucherDetail(id: string) {
  const [voucher] = await db
    .select({
      id: schema.lexofficeVouchers.id,
      lexofficeId: schema.lexofficeVouchers.lexofficeId,
      source: schema.lexofficeVouchers.source,
      type: schema.lexofficeVouchers.type,
      direction: schema.lexofficeVouchers.direction,
      number: schema.lexofficeVouchers.number,
      date: schema.lexofficeVouchers.date,
      dueDate: schema.lexofficeVouchers.dueDate,
      serviceFrom: schema.lexofficeVouchers.serviceFrom,
      serviceTo: schema.lexofficeVouchers.serviceTo,
      status: schema.lexofficeVouchers.status,
      contactId: schema.lexofficeVouchers.contactId,
      contactName: schema.lexofficeVouchers.contactName,
      currency: schema.lexofficeVouchers.currency,
      net: schema.lexofficeVouchers.net,
      tax: schema.lexofficeVouchers.tax,
      gross: schema.lexofficeVouchers.gross,
      taxes: schema.lexofficeVouchers.taxes,
      categories: schema.lexofficeVouchers.categories,
      payment: schema.lexofficeVouchers.payment,
      remark: schema.lexofficeVouchers.remark,
      createdAt: schema.lexofficeVouchers.createdAt,
    })
    .from(schema.lexofficeVouchers)
    .where(eq(schema.lexofficeVouchers.id, id));
  if (!voucher) return null;
  const files = await db
    .select({
      id: schema.lexofficeVoucherFiles.id,
      role: schema.lexofficeVoucherFiles.role,
      filename: schema.lexofficeVoucherFiles.filename,
      mimeType: schema.lexofficeVoucherFiles.mimeType,
      size: schema.lexofficeVoucherFiles.size,
      sha256: schema.lexofficeVoucherFiles.sha256,
    })
    .from(schema.lexofficeVoucherFiles)
    .where(eq(schema.lexofficeVoucherFiles.voucherId, id));
  return { voucher, files };
}

export async function legacyVoucherFile(fileId: string) {
  const [file] = await db.select().from(schema.lexofficeVoucherFiles).where(eq(schema.lexofficeVoucherFiles.id, fileId));
  return file ?? null;
}

/** Zahlungen, die bei Ist-Versteuerung als Entgelt zählen, mit dem Vorzeichen des Belegs (Gutschriften mindern die Umsätze) */
function legacyPayments(v: { gross: number; payment: LegacyPayment | null }) {
  return (v.payment?.items ?? [])
    .filter((p) => LEGACY_PAYMENT_TYPES.has(p.type) && p.date)
    .map((p) => ({ date: p.date, amount: Math.sign(v.gross) * Math.abs(p.amount) }));
}

/**
 * Steuerart aus der gespeicherten API-Antwort, in den Werten von Lexoffice. Lexoffice: Rechnungsmodul unter taxConditions,
 * Buchhaltungsbelege direkt. sevDesk: Steuerregel (Update 2.0), sonst die ältere taxType; Reverse Charge (Regel 5)
 * lässt sich nicht eindeutig einer Kennzahl zuordnen und bleibt unbekannt.
 */
function taxTypeOf(t: string) {
  return sql.raw(`case when ${t}.source = 'sevdesk' then
      case coalesce(${t}.raw->'taxRule'->>'id', '')
        when '1' then 'net' when '2' then 'thirdPartyCountryDelivery' when '3' then 'intraCommunitySupply'
        when '4' then 'vatfree' when '11' then 'vatfree'
        when '' then case coalesce(${t}.raw->>'taxType', 'default')
          when 'default' then 'net' when 'eu' then 'intraCommunitySupply' when 'ss' then 'vatfree'
          else 'sevdesk:' || (${t}.raw->>'taxType') end
        else 'sevdesk:taxRule' || (${t}.raw->'taxRule'->>'id') end
    else coalesce(${t}.raw->'taxConditions'->>'taxType', ${t}.raw->>'taxType') end`);
}
const TAX_TYPE = sql<string | null>`${taxTypeOf("lexoffice_vouchers")}`;
const TAX_SUB_TYPE = sql<string | null>`lexoffice_vouchers.raw->'taxConditions'->>'taxSubType'`;

/** Buchung ohne Beleg aus der Sicherung der Web-Oberfläche: hat keine Datei und braucht keine */
const WITHOUT_RECEIPT = sql<boolean>`coalesce((lexoffice_vouchers.raw->>'ohneBeleg')::boolean, false)`;

/** Weder Einnahme noch Ausgabe? Zur Laufzeit aus Kategorien und Rechtsform (legacyNeutralKind); die Rohdaten sind gesperrt */
function neutralKindOf(v: { privat: boolean; categories: LegacyCategoryRow[]; tax: number }, rechtsform: Rechtsform): LegacyNeutralKind | null {
  return legacyNeutralKind({ privat: v.privat, categories: v.categories.map((c) => c.name), tax: Number(v.tax) }, rechtsform);
}

export type ReconciliationCheck = { ok: boolean; label: string; detail: string };

/** Abgleich je Geschäftsjahr: Was liegt vor, was fehlt noch vor der Kündigung? */
export async function reconciliation() {
  const company = await loadCompany();
  const versteuerung: Versteuerung = company.versteuerung;

  const voucherRows = await db
    .select({
      direction: schema.lexofficeVouchers.direction,
      type: schema.lexofficeVouchers.type,
      number: schema.lexofficeVouchers.number,
      date: schema.lexofficeVouchers.date,
      status: schema.lexofficeVouchers.status,
      net: schema.lexofficeVouchers.net,
      tax: schema.lexofficeVouchers.tax,
      gross: schema.lexofficeVouchers.gross,
      taxes: schema.lexofficeVouchers.taxes,
      categories: schema.lexofficeVouchers.categories,
      payment: schema.lexofficeVouchers.payment,
      taxType: TAX_TYPE,
      taxSubType: TAX_SUB_TYPE,
      ohneBeleg: WITHOUT_RECEIPT,
      privat: sql<boolean>`coalesce((lexoffice_vouchers.raw->>'privat')::boolean, false)`,
      // Spalte ausdrücklich qualifizieren: drizzle schreibt sonst nur "id", und das träfe f.id
      files: sql<number>`(select count(*)::int from lexoffice_voucher_files f where f.voucher_id = lexoffice_vouchers.id)`,
    })
    .from(schema.lexofficeVouchers);
  // Archiviert, aber weder Einnahme noch Ausgabe: im Einzelunternehmen Privates und Geldtransit, in GmbH und UG
  // Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen; sie stehen je Jahr getrennt (neutral)
  const classified = voucherRows.map((v) => ({ ...v, neutral: neutralKindOf(v, company.rechtsform) }));
  const businessRows = classified.filter((v) => !v.neutral);

  const bookingRows = await db.execute<{ year: number; total: number; unmatched: number; without_number: number }>(sql`
    select extract(year from b.date)::int as year, count(*)::int as total,
      count(*) filter (where b.voucher_field1 <> '' and not exists (
        select 1 from lexoffice_vouchers v where v.number <> ''
          and lower(regexp_replace(v.number, '\\s+', '', 'g')) = lower(regexp_replace(b.voucher_field1, '\\s+', '', 'g'))))::int as unmatched,
      count(*) filter (where b.voucher_field1 = '')::int as without_number
    from datev_bookings b group by 1`);
  const files = await db.select({ kind: schema.archiveFiles.kind, year: schema.archiveFiles.year }).from(schema.archiveFiles);
  const lastImport = await latestImport();
  // Für Jahre ohne Belege per API (Umzug nur über DATEV): Summen aus dem Buchungsstapel
  const datevRows = await db
    .select({
      date: schema.datevBookings.date,
      amount: schema.datevBookings.amount,
      side: schema.datevBookings.side,
      account: schema.datevBookings.account,
      contraAccount: schema.datevBookings.contraAccount,
      buKey: schema.datevBookings.buKey,
      accountLength: sql<number | null>`(${schema.archiveFiles.meta} -> 'header' ->> 'accountLength')::int`,
    })
    .from(schema.datevBookings)
    .leftJoin(schema.archiveFiles, eq(schema.archiveFiles.id, schema.datevBookings.fileId));

  const years = new Set<number>();
  for (const v of voucherRows) years.add(Number(v.date.slice(0, 4)));
  for (const b of bookingRows) years.add(Number(b.year));
  for (const f of files) if (f.year) years.add(f.year);

  const result = [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const vouchers = businessRows.filter((v) => v.date.startsWith(`${year}-`));
      // Alle Belege des Jahres, auch neutrale: Auch ein Körperschaftsteuerbescheid braucht seine Datei
      const yearRows = classified.filter((v) => v.date.startsWith(`${year}-`));
      const withoutReceipt = voucherRows.filter((v) => v.ohneBeleg && v.date.startsWith(`${year}-`)).length;
      const yearBookings = vouchers.length === 0 ? datevRows.filter((b) => b.date.startsWith(`${year}-`)) : [];
      const fromDatev = yearBookings.length > 0 ? datevYearSums(yearBookings, company.kontenrahmen) : null;
      const sum = (direction: "einnahme" | "ausgabe") => {
        if (fromDatev) {
          const { net, tax } = direction === "einnahme" ? fromDatev.einnahmen : fromDatev.ausgaben;
          return { count: 0, net, tax, gross: net + tax };
        }
        const rows = vouchers.filter((v) => v.direction === direction);
        return {
          count: rows.length,
          net: rows.reduce((s, r) => s + r.net, 0),
          tax: rows.reduce((s, r) => s + r.tax, 0),
          gross: rows.reduce((s, r) => s + r.gross, 0),
        };
      };
      const withoutFile = yearRows.filter((v) => !v.ohneBeleg && Number(v.files) === 0).length;
      const unchecked = vouchers.filter((v) => v.status === "unchecked").length;
      const bookings = bookingRows.find((b) => Number(b.year) === year);
      const kinds = (kind: string) => files.filter((f) => f.year === year && f.kind === kind).length;
      // Ist-Versteuerung: Zahlungen aus dem Zahlungsstatus; sonst Belegdatum
      const vat = legacyVatByMonth(
        businessRows
          .filter((v) => (versteuerung === "ist" ? true : v.date.startsWith(`${year}-`)))
          .map((v) => ({
            direction: v.direction,
            date: v.date,
            net: v.net,
            tax: v.tax,
            gross: v.gross,
            taxes: v.taxes,
            payments: legacyPayments(v),
            taxType: v.taxType,
            taxSubType: v.taxSubType,
          })),
        versteuerung,
      ).filter((m) => m.month.startsWith(`${year}-`));
      // Einnahmen je Steuerart, damit Sonderfälle (EU, Drittland, § 13b) beim Vergleich auffallen
      const taxTypes = new Map<string, number>();
      for (const v of vouchers) {
        if (v.direction !== "einnahme") continue;
        const key = [v.taxType ?? "net", v.taxSubType].filter(Boolean).join("/");
        taxTypes.set(key, (taxTypes.get(key) ?? 0) + 1);
      }
      const invoices = vouchers
        .filter((v) => v.type === "invoice" && v.number)
        .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "de", { numeric: true }));

      const checks: ReconciliationCheck[] = [
        {
          ok: vouchers.length > 0,
          label: "Belege und Rechnungen per API abgerufen",
          detail: [
            `${yearRows.filter((v) => !v.ohneBeleg).length} Belege`,
            withoutReceipt > 0 ? `${withoutReceipt} ${withoutReceipt === 1 ? "Buchung" : "Buchungen"} ohne Beleg` : "",
          ]
            .filter(Boolean)
            .join(", "),
        },
        {
          ok: withoutFile === 0,
          label: "Jeder Beleg hat eine Datei",
          detail: withoutFile === 0 ? "alle mit Datei" : `${withoutFile} ohne Datei`,
        },
        {
          ok: Boolean(bookings && bookings.total > 0),
          label: "DATEV-Buchungsstapel übernommen",
          detail: bookings ? `${bookings.total} Buchungen` : "fehlt",
        },
        {
          ok: Boolean(bookings) && bookings!.unmatched === 0,
          // Buchungen ohne Belegnummer (Umbuchungen, Privates) brauchen nicht immer einen Beleg; sie stehen nur im Hinweis
          label: "Jede Buchung mit Belegnummer findet ihren Beleg",
          detail: bookings
            ? [
                bookings.unmatched === 0 ? "alle gefunden" : `${bookings.unmatched} ohne passenden Beleg`,
                bookings.without_number > 0 ? `${bookings.without_number} ohne Belegnummer` : "",
              ]
                .filter(Boolean)
                .join(", ")
            : "–",
        },
        { ok: kinds("idea") > 0, label: "IDEA-Export archiviert", detail: kinds("idea") > 0 ? "liegt vor" : "fehlt" },
        {
          ok: kinds("elster") > 0,
          label: "ELSTER-Protokolle archiviert",
          detail: kinds("elster") > 0 ? `${kinds("elster")} Dateien` : "fehlen",
        },
        {
          ok: kinds("kontoauszug") > 0,
          label: "Kontoauszüge archiviert",
          detail: kinds("kontoauszug") > 0 ? `${kinds("kontoauszug")} Dateien` : "fehlen",
        },
      ];
      return {
        year,
        einnahmen: sum("einnahme"),
        ausgaben: sum("ausgabe"),
        /** Weder Einnahme noch Ausgabe, je Art: zum Vergleich sichtbar statt still weggelassen */
        neutral: legacyNeutralSums(yearRows.flatMap((v) => (v.neutral ? [{ kind: v.neutral, direction: v.direction, gross: v.gross }] : []))),
        /** "datev": keine Belege per API, die Summen stammen aus dem Buchungsstapel */
        sumsFrom: fromDatev ? ("datev" as const) : ("belege" as const),
        withoutFile,
        unchecked,
        bookings: bookings ? { total: bookings.total, unmatched: bookings.unmatched, withoutNumber: bookings.without_number } : null,
        vat,
        taxTypes: [...taxTypes].map(([taxType, count]) => ({ taxType, count })).sort((a, b) => b.count - a.count),
        lastInvoiceNumber: invoices.at(-1)?.number ?? null,
        checks,
        ready: checks.every((c) => c.ok),
      };
    });
  return { versteuerung, rechtsform: company.rechtsform, years: result, lastImport };
}

// ---------------------------------------------------------------------------------------------
// Für KI-Assistenten: Belege eines Zeitraums mit allem, was in die Nachrechnung der Umsatzsteuer eingeht

export interface LegacyVoucherForVat {
  id: string;
  type: string;
  direction: "einnahme" | "ausgabe";
  number: string;
  date: string;
  status: string;
  contactName: string;
  currency: string;
  net: number;
  tax: number;
  gross: number;
  taxes: LegacyTaxRow[];
  taxType: string | null;
  taxSubType: string | null;
  /** Zahlungen, die bei Ist-Versteuerung als Entgelt zählen */
  payments: { date: string; amount: number }[];
  files: number;
}

/**
 * Belege mit Belegdatum im Zeitraum (JJJJ oder JJJJ-MM). Mit `withPayments` auch Einnahmen, die in diesem
 * Zeitraum bezahlt wurden: Das sind bei Ist-Versteuerung die Belege, aus denen die Monatswerte stammen.
 */
export async function legacyVouchersForPeriod(filter: {
  period: string;
  direction: "alle" | "einnahme" | "ausgabe";
  search: string;
  withPayments: boolean;
  limit: number;
}): Promise<{ total: number; vouchers: LegacyVoucherForVat[]; neutral: LegacyNeutralSum[] }> {
  const like = `${filter.period}%`;
  const term = filter.search.trim() ? `%${filter.search.trim()}%` : null;
  const rows = await db.execute<{
    id: string;
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    status: string;
    contact_name: string;
    currency: string;
    net: number;
    tax: number;
    gross: number;
    taxes: LegacyTaxRow[];
    payment: LegacyPayment | null;
    categories: LegacyCategoryRow[];
    privat: boolean;
    tax_type: string | null;
    tax_sub_type: string | null;
    files: number;
  }>(sql`
    select v.id, v.type, v.direction, v.number, v.date::text as date, v.status, v.contact_name, v.currency, v.net, v.tax, v.gross,
      v.taxes, v.payment, v.categories, coalesce((v.raw->>'privat')::boolean, false) as privat,
      ${taxTypeOf("v")} as tax_type,
      v.raw->'taxConditions'->>'taxSubType' as tax_sub_type,
      (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files
    from lexoffice_vouchers v
    where (v.date::text like ${like}
      ${
        filter.withPayments
          ? sql`or (v.direction = 'einnahme' and exists (
              select 1 from jsonb_array_elements(coalesce(v.payment->'items', '[]'::jsonb)) i
              where i->>'date' like ${like} and i->>'type' in (${sql.join(
                [...LEGACY_PAYMENT_TYPES].map((t) => sql`${t}`),
                sql`, `,
              )})))`
          : sql``
      })
      ${filter.direction === "alle" ? sql`` : sql`and v.direction = ${filter.direction}`}
      ${term ? sql`and (v.number ilike ${term} or v.contact_name ilike ${term} or v.remark ilike ${term})` : sql``}
    order by v.date, v.number`);
  // Was weder Einnahme noch Ausgabe ist, geht nicht in die Umsatzsteuer ein, wie im Abgleich; es steht summiert daneben
  const { rechtsform } = await loadCompany();
  const classified = [...rows].map((r) => ({ ...r, neutral: neutralKindOf(r, rechtsform) }));
  const neutral = legacyNeutralSums(classified.flatMap((r) => (r.neutral ? [{ kind: r.neutral, direction: r.direction, gross: Number(r.gross) }] : [])));
  const all = classified
    .filter((r) => !r.neutral)
    .map((r) => ({
      id: r.id,
      type: r.type,
      direction: r.direction,
      number: r.number,
      date: r.date,
      status: r.status,
      contactName: r.contact_name,
      currency: r.currency,
      net: Number(r.net),
      tax: Number(r.tax),
      gross: Number(r.gross),
      taxes: r.taxes,
      taxType: r.tax_type,
      taxSubType: r.tax_sub_type,
      payments: legacyPayments({ gross: Number(r.gross), payment: r.payment }),
      files: Number(r.files),
    }));
  return { total: all.length, vouchers: all.slice(0, filter.limit), neutral };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ein Beleg mit der gespeicherten API-Antwort, gesucht nach ID in Haben, ID in Lexoffice bzw. sevDesk oder Belegnummer
 * (Leerzeichen und Groß-/Kleinschreibung egal). Bei einer Nummer können es mehrere sein.
 */
export async function findLegacyVouchers(ref: string) {
  const value = ref.trim();
  if (!value) return [];
  const rows = await db
    .select({ id: schema.lexofficeVouchers.id, raw: schema.lexofficeVouchers.raw })
    .from(schema.lexofficeVouchers)
    .where(
      UUID.test(value)
        ? sql`${schema.lexofficeVouchers.id} = ${value}::uuid or ${schema.lexofficeVouchers.lexofficeId} = ${value}`
        : // sevDesk-Kennungen wie "invoice/101" sind keine UUID
          sql`${schema.lexofficeVouchers.lexofficeId} = ${value}
            or lower(regexp_replace(${schema.lexofficeVouchers.number}, '\\s+', '', 'g')) = lower(regexp_replace(${value}, '\\s+', '', 'g'))`,
    )
    .limit(10);
  const result = [];
  for (const row of rows) {
    const detail = await legacyVoucherDetail(row.id);
    if (detail) result.push({ ...detail, raw: row.raw });
  }
  return result;
}
