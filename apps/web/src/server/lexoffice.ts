import {
  LexofficeApiError,
  LexofficeClient,
  mapContact,
  mapPayments,
  mapSalesDocument,
  mapVoucher,
  type LegacyVoucher,
  type LexFile,
  type LexofficeClientOptions,
} from "@haben/import";
import { legacyVatByMonth, type Versteuerung } from "@haben/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { loadCompany } from "./company.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { env } from "./env.ts";
import { db, schema } from "./db/index.ts";
import type { LexofficeImportProgress } from "./db/schema.ts";
import { sha256Of, sniff, storeFile } from "./storage.ts";

export class LexofficeError extends Error {}

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
const STALE_MS = 3 * 60 * 1000;

function userMessage(error: unknown): string {
  if (error instanceof LexofficeApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
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
    throw new LexofficeError(`Lexware Office lehnt den Schlüssel ab: ${userMessage(error)}`);
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
  const [row] = await db.select().from(schema.lexofficeImports).orderBy(desc(schema.lexofficeImports.startedAt)).limit(1);
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
 * Startet den Abruf im Hintergrund. Schon übernommene Belege werden übersprungen, ein neuer Lauf setzt
 * also nach einem Abbruch fort. Gibt die ID des Laufs zurück; den Fortschritt liefert latestImport().
 */
export async function startImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const key = await apiKey();
  if (!key) throw new LexofficeError("Zuerst den API-Schlüssel hinterlegen.");
  const current = await latestImport();
  if (current?.status === "laeuft") throw new LexofficeError("Ein Abruf läuft bereits.");
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
    tx.insert(schema.lexofficeImports).values({ progress }).returning({ id: schema.lexofficeImports.id }),
  );
  const id = row!.id;
  const controller = new AbortController();
  running.set(id, controller);
  const client = clientFactory({ apiKey: key, signal: controller.signal });
  const job = runImport(actor, id, client, progress)
    .then(() => finish(id, progress, "fertig", null))
    .catch((error: unknown) =>
      finish(id, progress, controller.signal.aborted ? "abgebrochen" : "fehler", controller.signal.aborted ? "Abgebrochen." : userMessage(error)),
    )
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

async function finish(id: string, progress: LexofficeImportProgress, status: "fertig" | "fehler" | "abgebrochen", error: string | null) {
  progress.phase = "fertig";
  await db
    .update(schema.lexofficeImports)
    .set({ status, error, progress, updatedAt: new Date(), finishedAt: new Date() })
    .where(eq(schema.lexofficeImports.id, id));
}

async function runImport(actor: string, importId: string, client: LexofficeClient, progress: LexofficeImportProgress) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  // 1. Kontakte: vorhandene über die Lexoffice-ID überspringen, gleichnamige ohne ID verknüpfen
  for await (const raw of client.contacts()) {
    const contact = mapContact(raw);
    await withActor(actor, async (tx) => {
      const [known] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(eq(schema.contacts.lexofficeId, contact.lexofficeId));
      if (known) return;
      const [sameName] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(isNull(schema.contacts.lexofficeId), sql`lower(${schema.contacts.name}) = lower(${contact.name})`))
        .limit(1);
      if (sameName) {
        await tx.update(schema.contacts).set({ lexofficeId: contact.lexofficeId }).where(eq(schema.contacts.id, sameName.id));
        progress.contactsLinked += 1;
        return;
      }
      await tx.insert(schema.contacts).values({
        lexofficeId: contact.lexofficeId,
        kundennummer: contact.kundennummer,
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
  const done = new Set(
    (await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers)).map((r) => r.id),
  );

  // 3. Je Beleg Details, Zahlungen und Dateien; Fehler einzelner Belege halten den Lauf nicht auf
  progress.phase = "belege";
  await save(true);
  for (const item of listed) {
    if (done.has(item.id)) {
      progress.skipped += 1;
      continue;
    }
    try {
      await importVoucher(actor, importId, client, item, categories, progress);
      progress.imported += 1;
    } catch (error) {
      // Schlüssel ungültig, Tarif gewechselt oder abgebrochen: weitermachen ist sinnlos
      if (error instanceof LexofficeApiError && (error.status === 401 || error.status === 403)) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      progress.failed.push({ lexofficeId: item.id, number: item.number, message: userMessage(error) });
    }
    await save();
  }
  await save(true);
}

async function importVoucher(
  actor: string,
  importId: string,
  client: LexofficeClient,
  item: { id: string; type: string },
  categories: Map<string, string>,
  progress: LexofficeImportProgress,
) {
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

  await withActor(actor, async (tx) => {
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
    if (!row) return;
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
  });
}

function fallbackName(voucher: LegacyVoucher, role: "pdf" | "xml" | "anhang", bytes: Uint8Array): string {
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
    select v.id, v.type, v.direction, v.number, v.date::text as date, v.status, v.contact_name, v.net, v.tax, v.gross,
      (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files
    from lexoffice_vouchers v
    where v.date between ${`${filter.year}-01-01`} and ${`${filter.year}-12-31`}
      ${filter.direction === "alle" ? sql`` : sql`and v.direction = ${filter.direction}`}
      ${term ? sql`and (v.number ilike ${term} or v.contact_name ilike ${term} or v.remark ilike ${term})` : sql``}
      ${filter.ohneDatei ? sql`and not exists (select 1 from lexoffice_voucher_files f where f.voucher_id = v.id)` : sql``}
    order by v.date, v.number
    limit 1000`);
  return [...rows].map((r) => ({
    id: r.id,
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

/** Zahlungsarten, die Geld bewegen; Skonto, Mahnkosten, Kursdifferenz und Forderungsausfall zählen nicht als Entgelt */
const PAYMENT_ITEM_TYPES = new Set(["partPaymentFinancialTransaction", "partPaymentCashBox", "manualPayment", "partPaymentCreditNote"]);

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
      payment: schema.lexofficeVouchers.payment,
      // Spalte ausdrücklich qualifizieren: drizzle schreibt sonst nur "id", und das träfe f.id
      files: sql<number>`(select count(*)::int from lexoffice_voucher_files f where f.voucher_id = lexoffice_vouchers.id)`,
    })
    .from(schema.lexofficeVouchers);

  const bookingRows = await db.execute<{ year: number; total: number; unmatched: number; without_number: number }>(sql`
    select extract(year from b.date)::int as year, count(*)::int as total,
      count(*) filter (where b.voucher_field1 <> '' and not exists (
        select 1 from lexoffice_vouchers v where v.number <> ''
          and lower(regexp_replace(v.number, '\\s+', '', 'g')) = lower(regexp_replace(b.voucher_field1, '\\s+', '', 'g'))))::int as unmatched,
      count(*) filter (where b.voucher_field1 = '')::int as without_number
    from datev_bookings b group by 1`);
  const files = await db
    .select({ kind: schema.archiveFiles.kind, year: schema.archiveFiles.year })
    .from(schema.archiveFiles);
  const lastImport = await latestImport();

  const years = new Set<number>();
  for (const v of voucherRows) years.add(Number(v.date.slice(0, 4)));
  for (const b of bookingRows) years.add(Number(b.year));
  for (const f of files) if (f.year) years.add(f.year);

  const result = [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const vouchers = voucherRows.filter((v) => v.date.startsWith(`${year}-`));
      const sum = (direction: "einnahme" | "ausgabe") => {
        const rows = vouchers.filter((v) => v.direction === direction);
        return {
          count: rows.length,
          net: rows.reduce((s, r) => s + r.net, 0),
          tax: rows.reduce((s, r) => s + r.tax, 0),
          gross: rows.reduce((s, r) => s + r.gross, 0),
        };
      };
      const withoutFile = vouchers.filter((v) => Number(v.files) === 0).length;
      const unchecked = vouchers.filter((v) => v.status === "unchecked").length;
      const bookings = bookingRows.find((b) => Number(b.year) === year);
      const kinds = (kind: string) => files.filter((f) => f.year === year && f.kind === kind).length;
      // Ist-Versteuerung: Zahlungen aus dem Zahlungsstatus; sonst Belegdatum
      const vat = legacyVatByMonth(
        voucherRows
          .filter((v) => (versteuerung === "ist" ? true : v.date.startsWith(`${year}-`)))
          .map((v) => ({
            direction: v.direction,
            date: v.date,
            net: v.net,
            tax: v.tax,
            gross: v.gross,
            taxes: v.taxes,
            payments: (v.payment?.items ?? [])
              .filter((p) => PAYMENT_ITEM_TYPES.has(p.type) && p.date)
              // Vorzeichen wie der Beleg, damit Gutschriften die Umsätze mindern
              .map((p) => ({ date: p.date, amount: Math.sign(v.gross) * Math.abs(p.amount) })),
          })),
        versteuerung,
      ).filter((m) => m.month.startsWith(`${year}-`));
      const invoices = vouchers
        .filter((v) => v.type === "invoice" && v.number)
        .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "de", { numeric: true }));

      const checks: ReconciliationCheck[] = [
        {
          ok: vouchers.length > 0,
          label: "Belege und Rechnungen per API abgerufen",
          detail: `${vouchers.length} Belege`,
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
        withoutFile,
        unchecked,
        bookings: bookings ? { total: bookings.total, unmatched: bookings.unmatched, withoutNumber: bookings.without_number } : null,
        vat,
        lastInvoiceNumber: invoices.at(-1)?.number ?? null,
        checks,
        ready: checks.every((c) => c.ok),
      };
    });
  return { versteuerung, years: result, lastImport };
}
