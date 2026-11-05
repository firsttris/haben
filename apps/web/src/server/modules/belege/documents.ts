import { isUniqueViolation, UserError, userMessage } from "../../errors.ts";
import {
  ACCOUNTS,
  ASSET_KIND_KEYS,
  ASSET_METHOD_KEYS,
  assetAccount,
  assetIssues,
  convertForeignAmounts,
  CURRENCY_CODE,
  documentPosting,
  documentSplitPosting,
  EXPENSE_CATEGORY_KEYS,
  formatRateMonth,
  mostFrequent,
  parseExchangeRate,
  rateMonth,
  type ExpenseCategory,
  periodRange,
  type VatPeriod,
  isKapitalgesellschaft,
  SELF_ASSESSED_TAX_KEYS,
  normalizeUstId,
  ustIdProblem,
  maxDegressiveRate,
  usesUsefulLife,
  ELEKTRO_NUR_EINZELUNTERNEHMEN,
  elektroAvailable,
  type AssetKind,
  type AssetMethod,
  type Cents,
} from "@haben/core";
import { readEInvoice, type IncomingInvoice } from "@haben/einvoice";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany, resolveExchangeRate } from "../stammdaten/index.ts";
import { addDocumentCashEntry, lockCash } from "../bank/index.ts";
import { isReadOnly, withActor } from "../../db/actor.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { fileInUse } from "../../db/file-in-use.ts";
import { today } from "../../today.ts";
import { describeExtractionError, extractDocument, extractionAvailable, type ExtractedFields } from "./extraction.ts";
import { loadFile, removeFile, sniff, storeFile } from "../../storage.ts";
import { findDocumentByReference, type DocumentReference } from "./external-reference.ts";
import { loadSplits, replaceSplits, splitBookingIssues, splitInputSchema, splitLines, type DocumentSplit } from "./splits.ts";

export type Document = typeof schema.documents.$inferSelect;
export type DocumentAmount = typeof schema.documentAmounts.$inferSelect;

export class DocumentError extends UserError {}

export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

const isoDate = z.iso.date();
const cents = z.number().int().min(-100_000_000_00).max(100_000_000_00);

export const documentInputSchema = z.object({
  supplierName: z.string().trim().max(200),
  supplierUstId: z.string().trim().max(20),
  /** Aus den Kontakten gewählter Lieferant; null = frei eingetragen */
  supplierContactId: z.uuid().nullable().default(null),
  invoiceNumber: z.string().trim().max(100),
  documentDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  category: z.enum(EXPENSE_CATEGORY_KEYS).nullable(),
  payment: z.enum(["bank", "privat", "kasse"]),
  note: z.string().max(2000),
  /** Privatanteil in Prozent, z. B. beim Handyvertrag */
  privateShare: z.number().int().min(0).max(100).default(0),
  /** § 13b oder innergemeinschaftlicher Erwerb: Steuer schuldest du selbst; die Beträge tragen die selbst berechnete Steuer */
  reverseCharge: z.enum(SELF_ASSESSED_TAX_KEYS).nullable().default(null),
  /** Nur bei Kategorie „anlage“ */
  asset: z
    .object({
      name: z.string().trim().min(1, "Bezeichnung der Anlage fehlt").max(200),
      kind: z.enum(ASSET_KIND_KEYS),
      method: z.enum(ASSET_METHOD_KEYS),
      usefulLifeMonths: z.number().int().min(1).max(600).nullable(),
    })
    .nullable()
    .default(null),
  /** Währung des Belegs; bei Fremdwährung tragen die Zeilen die Originalbeträge, Euro rechnet Haben mit dem Kurs aus */
  currency: z.string().trim().toUpperCase().regex(CURRENCY_CODE, "Währung als dreistelliger Code, z. B. USD").default("EUR"),
  /** 1 EUR = Kurs Fremdwährung, z. B. "1,0812"; leer, solange der Kurs noch fehlt */
  exchangeRate: z
    .string()
    .nullable()
    .default(null)
    .transform((value, ctx) => {
      if (value === null || value.trim() === "") return null;
      const rate = parseExchangeRate(value);
      if (!rate) ctx.addIssue({ code: "custom", message: "Umrechnungskurs ungültig, z. B. 1,0812" });
      return rate;
    }),
  /** Kursdatum bei einem Tageskurs (wenn das Finanzamt ihn gestattet hat) oder einem Kurs aus der Bankabrechnung */
  exchangeRateDate: isoDate.nullable().default(null),
  amounts: z
    .array(
      z.object({
        taxRate: z.union([z.literal(1900), z.literal(700), z.literal(0)]),
        net: cents,
        tax: cents,
        /** Nur bei Fremdwährung: Beträge laut Beleg in der Fremdwährung */
        originalNet: cents.nullable().default(null),
        originalTax: cents.nullable().default(null),
      }),
    )
    .max(3)
    .refine((rows) => new Set(rows.map((r) => r.taxRate)).size === rows.length, "Jeder Steuersatz nur einmal"),
  /** Aufteilung auf mehrere Kategorien (#271); leer = die Kategorie oben gilt für den ganzen Beleg */
  splits: z.array(splitInputSchema).max(50).default([]),
});

/** Höchstwert der int4-Spalten: umgerechnete Beträge (kleiner Kurs) dürfen ihn nicht sprengen */
const MAX_EURO_CENTS = 2_147_483_647;

/**
 * Euro-Beträge je Zeile: in Euro wie eingegeben, bei Fremdwährung mit dem Kurs umgerechnet.
 * Ohne Kurs bleiben die Euro-Beträge 0; der Beleg ist dann noch nicht buchbar.
 */
export function euroAmounts(input: {
  currency: string;
  exchangeRate: string | null;
  reverseCharge: string | null;
  amounts: { taxRate: number; net: number; tax: number; originalNet: number | null; originalTax: number | null }[];
}): { taxRate: number; net: number; tax: number; originalNet: number | null; originalTax: number | null }[] {
  if (input.currency === "EUR") return input.amounts.map((a) => ({ taxRate: a.taxRate, net: a.net, tax: a.tax, originalNet: null, originalTax: null }));
  const originals = input.amounts.map((a) => ({ taxRate: a.taxRate, originalNet: a.originalNet ?? 0, originalTax: a.originalTax ?? 0 }));
  if (!input.exchangeRate) return originals.map((o) => ({ ...o, net: 0, tax: 0 }));
  const euro = convertForeignAmounts(originals, input.exchangeRate, Boolean(input.reverseCharge));
  if (euro.some((e) => Math.abs(e.net) > MAX_EURO_CENTS || Math.abs(e.tax) > MAX_EURO_CENTS)) {
    throw new DocumentError("Der umgerechnete Betrag ist zu groß. Stimmt der Kurs (1 EUR = … Fremdwährung)?");
  }
  return originals.map((o, i) => ({ ...o, net: euro[i]!.net, tax: euro[i]!.tax }));
}

export type DocumentInput = z.input<typeof documentInputSchema>;

/** Kurs eines Fremdwährungsbelegs: Monat laut Belegdatum (siehe resolveExchangeRate) */
function resolveRate(
  q: Db | Tx,
  input: { currency: string; documentDate: string | null; exchangeRate: string | null; exchangeRateDate: string | null },
  previous: Pick<Document, "exchangeRate" | "exchangeRateSource"> | null,
  tageskurs: boolean,
) {
  return resolveExchangeRate(q, { ...input, date: input.documentDate }, previous, tageskurs);
}

/** Bei § 13b zahlst du nur netto; die Steuer geht ans Finanzamt, nicht an den Lieferanten */
function totalsOf(amounts: { taxRate: number; net: number; tax: number }[], reverseCharge: string | null = null) {
  const net = amounts.reduce((s, a) => s + a.net, 0);
  const tax = amounts.reduce((s, a) => s + a.tax, 0);
  return { net, tax, gross: reverseCharge ? net : net + tax };
}

/**
 * Kategorie aus den gebuchten Belegen desselben Lieferanten (USt-IdNr. oder Name): die häufigste, bei Gleichstand die
 * zuletzt gebuchte, mit Anzahl für die Begründung („7 von 9 Belegen als Software gebucht“).
 */
export async function supplierCategory(
  supplierName: string,
  supplierUstId: string,
): Promise<{ category: ExpenseCategory; count: number; total: number } | null> {
  if (!supplierName.trim() && !supplierUstId.trim()) return null;
  const rows = await db
    .select({
      category: schema.documents.category,
      count: sql<number>`count(*)::int`,
      last: sql<string>`max(${schema.documents.lockedAt})::text`,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        // Ein stornierter Beleg war oft falsch erfasst; er soll den Vorschlag nicht prägen
        documentNotCancelled(),
        sql`${schema.documents.category} is not null`,
        or(
          supplierUstId.trim() ? eq(schema.documents.supplierUstId, supplierUstId.trim()) : sql`false`,
          supplierName.trim() ? sql`lower(${schema.documents.supplierName}) = lower(${supplierName.trim()})` : sql`false`,
        ),
      ),
    )
    .groupBy(schema.documents.category);
  const top = mostFrequent(rows.map((r) => ({ value: r.category as ExpenseCategory, count: r.count, last: r.last ?? "" })));
  return top ? { category: top.value, count: top.count, total: top.total } : null;
}

async function guessCategory(supplierName: string, supplierUstId: string): Promise<ExpenseCategory | null> {
  return (await supplierCategory(supplierName, supplierUstId))?.category ?? null;
}

function fieldsFromEInvoice(invoice: IncomingInvoice): ExtractedFields {
  const warnings: string[] = [];
  const amounts = invoice.taxes.flatMap((t) => {
    if (t.rate !== 1900 && t.rate !== 700 && t.rate !== 0) {
      warnings.push(`Steuersatz ${t.rate / 100} % wird nicht unterstützt`);
      return [];
    }
    return [{ taxRate: t.rate as 1900 | 700 | 0, net: t.base, tax: t.tax }];
  });
  if (invoice.currency !== "EUR") warnings.push(`Währung ${invoice.currency}: bitte den Umrechnungskurs eintragen`);
  return {
    supplierName: invoice.seller.name,
    supplierUstId: invoice.seller.ustId ?? "",
    invoiceNumber: invoice.number,
    documentDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? null,
    currency: invoice.currency,
    category: "sonstiges",
    amounts,
    warnings,
  };
}

/** Ein Betrag je Steuersatz (eindeutiger Index): z. B. 0 % „Z“ und „E“ einer E-Rechnung zusammen */
function amountsByRate(amounts: ExtractedFields["amounts"]): ExtractedFields["amounts"] {
  const byRate = new Map<number, ExtractedFields["amounts"][number]>();
  for (const a of amounts) {
    const seen = byRate.get(a.taxRate);
    byRate.set(a.taxRate, seen ? { ...seen, net: seen.net + a.net, tax: seen.tax + a.tax } : { ...a });
  }
  return [...byRate.values()];
}

/** Übernimmt ausgelesene Felder, solange der Beleg noch nicht gebucht ist. */
async function applyFields(
  actor: string,
  id: string,
  fields: ExtractedFields,
  extractedBy: "zugferd" | "xrechnung" | "ki",
  raw: Record<string, unknown>,
  categoryKnown: boolean,
) {
  const category = (await guessCategory(fields.supplierName, fields.supplierUstId)) ?? (categoryKnown ? fields.category : null);
  // Fremdwährung: die ausgelesenen Beträge sind die Originalbeträge; Euro mit dem USt-Kurs des Monats, sobald es ihn gibt
  const company = await loadCompany();
  const rate = await resolveRate(
    db,
    { currency: fields.currency, documentDate: fields.documentDate, exchangeRate: null, exchangeRateDate: null },
    null,
    company.tageskurs,
  );
  const amounts = euroAmounts({
    currency: fields.currency,
    exchangeRate: rate.exchangeRate,
    reverseCharge: null,
    amounts: amountsByRate(fields.amounts).map((a) => ({ ...a, originalNet: a.net, originalTax: a.tax })),
  });
  const totals = totalsOf(amounts);
  // Mit dem Kurs des Monats ist der Hinweis auf den fehlenden Kurs erledigt
  const warnings = rate.exchangeRate ? fields.warnings.filter((w) => !w.startsWith(`Währung ${fields.currency}`)) : fields.warnings;
  // Privatanteil aus den Vorgaben der Firmendaten, z. B. Telefon 20 %
  const { privateShares } = company;
  const privateShare = category ? (privateShares[category] ?? 0) : 0;
  await withActor(actor, async (tx) => {
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
    if (!doc || doc.lockedAt) return;
    await tx.delete(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
    if (amounts.length > 0) {
      await tx.insert(schema.documentAmounts).values(amounts.map((a) => ({ documentId: id, ...a })));
    }
    // Neu ausgelesen gilt die ausgelesene Kategorie; eine Aufteilung passte zu den alten Beträgen
    await replaceSplits(tx, id, [], []);
    await tx
      .update(schema.documents)
      .set({
        supplierName: fields.supplierName,
        supplierUstId: fields.supplierUstId,
        // Anderer Lieferant ausgelesen: die Verknüpfung zum Kontakt passt nicht mehr (wie beim Ändern von Hand)
        supplierContactId: fields.supplierName === doc.supplierName ? doc.supplierContactId : null,
        invoiceNumber: fields.invoiceNumber,
        documentDate: fields.documentDate,
        dueDate: fields.dueDate,
        currency: fields.currency,
        ...rate,
        category,
        privateShare,
        ...totals,
        extractedBy,
        extractionStatus: "fertig",
        extractionError: warnings.length > 0 ? warnings.join(" · ") : null,
        extraction: raw,
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, id));
  });
}

async function setExtractionState(actor: string, id: string, status: "laeuft" | "fehler" | "keine", error: string | null) {
  await withActor(actor, (tx) =>
    tx
      .update(schema.documents)
      .set({ extractionStatus: status, extractionError: error, updatedAt: new Date() })
      .where(and(eq(schema.documents.id, id), sql`${schema.documents.lockedAt} is null`)),
  );
}

/** Auslesungen, die in diesem Prozess laufen; was sonst auf „läuft“ steht, hat ein Neustart abgebrochen */
const runningExtractions = new Set<string>();

/** KI-Auslesung; läuft im Hintergrund, der Beleg zeigt solange „wird ausgelesen“. */
export async function runExtraction(actor: string, id: string): Promise<void> {
  // Vor dem ersten await eintragen, damit getDocument den Lauf nie für abgebrochen hält
  runningExtractions.add(id);
  try {
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc || doc.lockedAt) return;
    await extract(actor, doc);
  } finally {
    runningExtractions.delete(id);
  }
}

async function extract(actor: string, doc: Document): Promise<void> {
  const id = doc.id;
  await setExtractionState(actor, id, "laeuft", null);
  try {
    const bytes = await loadFile(doc.sha256);
    const sniffed = sniff(bytes);
    if (!sniffed) throw new DocumentError("Dateityp unbekannt");
    const { extraction, fields } = await extractDocument(bytes, sniffed.kind);
    await applyFields(actor, id, fields, "ki", extraction, true);
  } catch (error) {
    await setExtractionState(actor, id, "fehler", describeExtractionError(error));
  }
}

export interface UploadResult {
  id: string;
  /** Kein neuer Beleg: dieselbe Datei oder dieselbe externe Referenz gab es schon, id ist dieser Beleg */
  duplicate: boolean;
}

export interface FileProblem {
  kind: "leer" | "zu_gross" | "format";
  message: string;
}

/** Was gegen die Datei als Beleg spricht, oder null; dieselben Regeln für Upload, E-Mail und REST-API */
export function documentFileProblem(file: { bytes: Uint8Array; filename: string }): FileProblem | null {
  if (file.bytes.byteLength === 0) return { kind: "leer", message: `${file.filename}: Die Datei ist leer.` };
  if (file.bytes.byteLength > MAX_DOCUMENT_SIZE) return { kind: "zu_gross", message: `${file.filename}: größer als 20 MB.` };
  if (!sniff(file.bytes)) return { kind: "format", message: `${file.filename}: Erlaubt sind PDF, JPEG, PNG, WebP, HEIC und E-Rechnungs-XML.` };
  return null;
}

/**
 * Beleg mit dieser Datei; nach einem Storno mit Neuerfassung (#237) der neueste, also die Neuerfassung. Belege aus einem
 * Dauerbeleg zählen nicht: Sie teilen sich den Vertrag, der als eigener Beleg hochgeladen werden darf.
 */
async function latestWithFile(sha256: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.sha256, sha256), isNull(schema.documents.recurringDocumentId)))
    .orderBy(desc(schema.documents.uploadedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Legt die Zeile an; null, wenn dieselbe Datei gleichzeitig angelegt wurde */
async function insertDocument(
  actor: string,
  row: { sha256: string; filename: string; mimeType: string; size: number; note: string; reference: DocumentReference | null },
): Promise<string | null> {
  const { reference, ...values } = row;
  return withActor(actor, async (tx) => {
    const [created] = await tx
      .insert(schema.documents)
      .values({ ...values, ...reference })
      // Eindeutig ist die Datei nur außerhalb der Neuerfassungen und Dauerbelege (documents_sha256)
      .onConflictDoNothing({
        target: schema.documents.sha256,
        where: sql`${schema.documents.replacesDocumentId} is null and ${schema.documents.recurringDocumentId} is null`,
      })
      .returning({ id: schema.documents.id });
    return created?.id ?? null;
  });
}

/**
 * Legt einen Beleg ab. E-Rechnungen werden sofort gelesen; andere PDFs und Fotos
 * gehen an die KI-Auslesung im Hintergrund, falls eingerichtet. Mit externer Referenz (REST-API) liefert dieselbe
 * Referenz den vorhandenen Beleg, auch bei gleichzeitigen Anfragen.
 */
export async function uploadDocument(
  actor: string,
  file: { bytes: Uint8Array; filename: string },
  options: { background?: (work: Promise<void>) => void; reference?: DocumentReference; note?: string } = {},
): Promise<UploadResult> {
  const problem = documentFileProblem(file);
  if (problem) throw new DocumentError(problem.message);
  const type = sniff(file.bytes)!;
  const reference = options.reference ?? null;
  // Vor dem Speichern: Wer dieselbe Referenz erneut schickt, hinterlässt keine zweite Datei
  const known = reference && (await findDocumentByReference(reference));
  if (known) return { id: known.id, duplicate: true };

  const sha256 = await storeFile(file.bytes);
  const existing = await latestWithFile(sha256);
  if (existing) return { id: existing, duplicate: true };

  const row = { sha256, filename: file.filename.slice(0, 200), mimeType: type.mimeType, size: file.bytes.byteLength, note: options.note ?? "", reference };
  let id: string | null;
  try {
    id = await insertDocument(actor, row);
  } catch (error) {
    // Gleichzeitig mit derselben Referenz angelegt: der andere Beleg gilt. Die eigene Datei bleibt liegen, denn eine
    // dritte Anfrage mit derselben Datei könnte sie gerade nutzen; unter ihrem Hash schadet sie nicht.
    const winner = reference && isUniqueViolation(error, "documents_external_ref") ? await findDocumentByReference(reference) : null;
    if (!winner) throw error;
    return { id: winner.id, duplicate: true };
  }
  if (!id) {
    return { id: (await latestWithFile(sha256))!, duplicate: true };
  }

  if (type.kind === "pdf" || type.kind === "xml") {
    try {
      const einvoice = await readEInvoice({ bytes: file.bytes, mimeType: type.mimeType, filename: file.filename });
      if (einvoice) {
        await applyFields(actor, id, fieldsFromEInvoice(einvoice.invoice), einvoice.source, { ...einvoice.invoice }, false);
        return { id, duplicate: false };
      }
    } catch (error) {
      if (type.kind === "xml") {
        // Meldungen für den Nutzer übernehmen; Interna wie Datenbankfehler gehören ins Server-Log
        await setExtractionState(actor, id, "fehler", userMessage(error) ?? describeExtractionError(error));
        return { id, duplicate: false };
      }
    }
  }

  if (extractionAvailable() && (type.kind === "pdf" || type.kind === "jpeg" || type.kind === "png" || type.kind === "webp")) {
    runningExtractions.add(id);
    await setExtractionState(actor, id, "laeuft", null);
    const work = runExtraction(actor, id);
    if (options.background) options.background(work);
    else await work;
  }
  return { id, duplicate: false };
}

async function lockOpen(tx: Tx, id: string): Promise<Document> {
  const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
  if (!doc) throw new DocumentError("Beleg nicht gefunden.");
  if (doc.lockedAt) throw new DocumentError("Der Beleg ist gebucht und kann nicht mehr geändert werden.");
  return doc;
}

export async function updateDocument(actor: string, id: string, input: DocumentInput): Promise<void> {
  await withActor(actor, async (tx) => {
    const previous = await lockOpen(tx, id);
    const parsed = documentInputSchema.parse(input);
    if (parsed.supplierContactId) {
      const [contact] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, parsed.supplierContactId));
      if (!contact) throw new DocumentError("Lieferant nicht gefunden.");
    }
    const rate = await resolveRate(tx, parsed, previous, (await loadCompany(tx)).tageskurs);
    const amounts = euroAmounts({ ...parsed, exchangeRate: rate.exchangeRate });
    await tx.delete(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
    if (amounts.length > 0) {
      await tx.insert(schema.documentAmounts).values(amounts.map((a) => ({ documentId: id, ...a })));
    }
    // Aufgeteilt: Kategorie und Anlage stehen in den Zeilen bzw. gibt es nicht (Anlagegüter lassen sich nicht aufteilen)
    await replaceSplits(tx, id, parsed.splits, amounts);
    const { amounts: _amounts, splits, asset, ...fields } = parsed;
    const category = splits.length > 0 ? null : fields.category;
    await tx
      .update(schema.documents)
      .set({
        ...fields,
        ...rate,
        category,
        asset: category === "anlage" ? (asset ?? null) : null,
        supplierUstId: fields.supplierUstId.replace(/\s/g, "").toUpperCase(),
        ...totalsOf(amounts, fields.reverseCharge),
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, id));
  });
}

export async function getDocument(id: string) {
  let [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!doc) return null;
  // Nur lesend (Steuerberatung) bleibt der Beleg, wie er ist; freigeben darf ihn erst der Inhaber beim Öffnen
  if (doc.extractionStatus === "laeuft" && !runningExtractions.has(id) && !isReadOnly()) {
    // Server während der Auslesung neu gestartet: Beleg wieder freigeben statt ewig „läuft“
    [doc] = await withActor("system:auslesung", (tx) =>
      tx
        .update(schema.documents)
        .set({ extractionStatus: "fehler", extractionError: "Die Auslesung wurde unterbrochen. Bitte erneut auslesen oder von Hand ausfüllen." })
        .where(and(eq(schema.documents.id, id), eq(schema.documents.extractionStatus, "laeuft"), sql`${schema.documents.lockedAt} is null`))
        .returning(),
    );
    [doc] = doc ? [doc] : await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc) return null;
  }
  const amounts = await db.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id)).orderBy(desc(schema.documentAmounts.taxRate));
  return { document: doc, amounts, splits: await loadSplits(id) };
}

/**
 * Belege in Fremdwährung ohne Kurs, deren USt-Umrechnungskurs inzwischen veröffentlicht ist: Kurs übernehmen und in Euro
 * umrechnen. Nach dem Abruf der Kurse; gibt die Zahl der umgerechneten Belege zurück.
 */
export async function applyPublishedRates(actor: string): Promise<number> {
  const open = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        sql`${schema.documents.currency} <> 'EUR'`,
        // Ohne Kurs oder mit übernommenem USt-Kurs: Ändert sich der Kurs in der Tabelle (der amtliche ersetzt einen vorab
        // von Hand eingetragenen), folgen ungebuchte Belege; ein eigener Kurs am Beleg bleibt
        sql`(${schema.documents.exchangeRate} is null or ${schema.documents.exchangeRateSource} = 'ust')`,
        sql`${schema.documents.lockedAt} is null`,
        sql`${schema.documents.documentDate} is not null`,
      ),
    );
  let count = 0;
  for (const candidate of open) {
    const applied = await withActor(actor, async (tx) => {
      const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, candidate.id)).for("update");
      if (!doc || doc.lockedAt || doc.currency === "EUR" || (doc.exchangeRate && doc.exchangeRateSource !== "ust")) return false;
      const rate = await resolveRate(tx, { ...doc, exchangeRate: null, exchangeRateDate: null }, null, false);
      if (!rate.exchangeRate || (doc.exchangeRate && parseExchangeRate(doc.exchangeRate) === rate.exchangeRate)) return false;
      const rows = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, doc.id));
      let amounts;
      try {
        amounts = euroAmounts({ currency: doc.currency, exchangeRate: rate.exchangeRate, reverseCharge: doc.reverseCharge, amounts: rows });
      } catch {
        // Umgerechnet zu groß: bleibt ohne Kurs, der Beleg zeigt es beim Speichern
        return false;
      }
      await tx.delete(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, doc.id));
      if (amounts.length > 0) await tx.insert(schema.documentAmounts).values(amounts.map((a) => ({ documentId: doc.id, ...a })));
      await tx
        .update(schema.documents)
        .set({ ...rate, ...totalsOf(amounts, doc.reverseCharge), updatedAt: new Date() })
        .where(eq(schema.documents.id, doc.id));
      return true;
    });
    if (applied) count++;
  }
  return count;
}

/** Fehlender Kurs: noch nicht veröffentlicht (laufender oder späterer Monat) oder nicht vorhanden */
function missingRateIssue(doc: Document, todayDate: string): string {
  if (!doc.documentDate) return `Umrechnungskurs für ${doc.currency} fehlt`;
  const month = rateMonth(doc.documentDate);
  return month >= rateMonth(todayDate)
    ? `Kurs für ${formatRateMonth(month)} noch nicht veröffentlicht; Haben übernimmt ihn nach Monatsende, oder trag einen Kurs von Hand ein`
    : `Umrechnungskurs für ${doc.currency} ${formatRateMonth(month)} fehlt`;
}

/**
 * Innergemeinschaftlicher Erwerb (§ 1a UStG), unabhängig von der Kategorie, auch für Anlagegüter: Der Lieferant ist
 * Unternehmer in einem anderen Mitgliedstaat (seine USt-IdNr. steht auf der Rechnung, § 14a Abs. 3 UStG) und berechnet
 * keine deutsche Umsatzsteuer. Haben rechnet die Erwerbsteuer zu 19 oder 7 %; steuerfreie Erwerbe (§ 4b UStG, Kz 91)
 * und andere Sätze (Kz 95/98) unterstützt es nicht.
 */
function igErwerbIssues(doc: Document, amounts: DocumentAmount[]): string[] {
  const issues: string[] = [];
  if (amounts.some((a) => a.taxRate === 0)) issues.push("Beim innergemeinschaftlichen Erwerb steht jede Zeile auf 19 % oder 7 %");
  // Geprüft wie die USt-IdNr. einer Lieferung in der Zusammenfassenden Meldung: Länderkennzeichen eines anderen Mitgliedstaats
  const ustId = normalizeUstId(doc.supplierUstId ?? "");
  if (!ustId) issues.push("Beim innergemeinschaftlichen Erwerb fehlt die USt-IdNr. des Lieferanten");
  else if (ustId.startsWith("DE"))
    issues.push("Lieferant mit deutscher USt-IdNr.: kein innergemeinschaftlicher Erwerb, die Rechnung muss deutsche Umsatzsteuer ausweisen");
  else {
    const problem = ustIdProblem(ustId, "L");
    if (problem) issues.push(`Lieferant ${problem}`);
  }
  return issues;
}

/** Was vor dem Buchen fehlt; leere Liste = bereit. Mit Aufteilung (splits) statt der Kategorie die Zeilen geprüft. */
export function bookingIssues(doc: Document, amounts: DocumentAmount[], todayDate = today(), splits: DocumentSplit[] = []): string[] {
  const issues: string[] = [];
  if (!doc.supplierName) issues.push("Lieferant fehlt");
  if (!doc.documentDate) issues.push("Belegdatum fehlt");
  if (splits.length > 0) issues.push(...splitBookingIssues(doc, amounts, splits));
  else if (!doc.category) issues.push("Kategorie fehlt");
  const foreign = doc.currency !== "EUR";
  if (foreign && !doc.exchangeRate) issues.push(missingRateIssue(doc, todayDate));
  if (foreign && amounts.some((a) => a.originalNet === null || a.originalTax === null)) issues.push(`Beträge in ${doc.currency} fehlen`);
  // Bei Fremdwährung zählen die Beträge laut Beleg; ohne Kurs stehen die Euro-Beträge noch auf 0
  const values = foreign ? amounts.map((a) => ({ net: a.originalNet ?? 0, tax: a.originalTax ?? 0 })) : amounts;
  if (values.length === 0 || values.every((a) => a.net === 0 && a.tax === 0)) issues.push("Beträge fehlen");
  // Mit Kurs, aber umgerechnet 0,00 € (winzige Beträge oder ein falscher Kurs): eine Buchung ohne Zeilen ginge nicht
  else if (foreign && doc.exchangeRate && amounts.every((a) => a.net === 0 && a.tax === 0)) issues.push("Umgerechnet 0,00 €, bitte den Kurs prüfen");
  if (doc.reverseCharge === "ig_erwerb") issues.push(...igErwerbIssues(doc, amounts));
  else if (doc.reverseCharge) {
    if (amounts.some((a) => a.taxRate === 0)) issues.push("Bei § 13b steht jede Zeile auf 19 % oder 7 %");
    if (doc.category === "anlage") issues.push("§ 13b bei Anlagegütern wird nicht unterstützt");
    // § 13b Abs. 1 und Abs. 2 Nr. 1 UStG: nur sonstige Leistungen und Werklieferungen; Waren sind innergemeinschaftlicher Erwerb (§ 1a UStG) oder Einfuhr
    if (doc.category === "wareneinkauf") issues.push("§ 13b gilt nicht für Wareneinkäufe");
  }
  if (doc.category === "anlage") {
    const net = amounts.reduce((s, a) => s + a.net, 0);
    if (!doc.asset) issues.push("Angaben zur Anlage fehlen");
    else if (doc.privateShare > 0) issues.push("Ein Privatanteil bei Anlagegütern wird nicht unterstützt");
    else if (net <= 0) issues.push("Gutschriften zu Anlagen werden nicht unterstützt");
    else if (doc.documentDate) {
      issues.push(...assetIssues(documentScheduleAsset(doc.asset, doc.documentDate, net)));
    }
  }
  return issues;
}

/**
 * Anlage aus dem Beleg: Nutzungsdauer nur bei linear und degressiv, bei degressiv der Höchstsatz (§ 7 Abs. 2 EStG).
 * Satz, Wechsel zur linearen AfA und Erinnerungswert lassen sich an der Anlage bis zur ersten AfA noch ändern.
 */
function documentAssetMethod(asset: { method: AssetMethod; usefulLifeMonths: number | null }, acquisitionDate: string) {
  const usefulLifeMonths = usesUsefulLife(asset.method) ? asset.usefulLifeMonths : null;
  const degressiveRate = asset.method === "degressiv" && usefulLifeMonths ? maxDegressiveRate(acquisitionDate, usefulLifeMonths) : null;
  return { usefulLifeMonths, degressiveRate };
}

function documentScheduleAsset(asset: { kind: AssetKind; method: AssetMethod; usefulLifeMonths: number | null }, acquisitionDate: string, cost: Cents) {
  return { acquisitionDate, cost, kind: asset.kind, method: asset.method, ...documentAssetMethod(asset, acquisitionDate) };
}

/** Bucht den Beleg (Aufwand + Vorsteuer an Verbindlichkeiten bzw. Privateinlage) und sperrt ihn. */
export async function bookDocument(actor: string, id: string): Promise<void> {
  await withActor(actor, (tx) => bookDocumentIn(tx, id));
}

/** Wie bookDocument, in einer laufenden Transaktion; etwa zusammen mit der Zuordnung im Bankabgleich */
export async function bookDocumentIn(tx: Tx, id: string): Promise<void> {
  const doc = await lockOpen(tx, id);
  // Kasse vor der ersten Buchung sperren, wie beim Kassenbuch selbst (siehe lockCash)
  if (doc.payment === "kasse") await lockCash(tx);
  const company = await openBooks(tx);
  const amounts = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
  const splits = await loadSplits(id, tx);
  const issues = bookingIssues(doc, amounts, today(), splits);
  // GmbH und UG: privat Genutztes ist Arbeitslohn oder verdeckte Gewinnausschüttung, keine Entnahme
  if (doc.privateShare > 0 && isKapitalgesellschaft(company.rechtsform)) issues.push("Einen Privatanteil gibt es nur im Einzelunternehmen");
  if (doc.category === "anlage" && doc.asset?.method === "elektro" && !elektroAvailable(company.rechtsform)) issues.push(ELEKTRO_NUR_EINZELUNTERNEHMEN);
  if (issues.length > 0) throw new DocumentError(`Noch nicht bereit: ${issues.join(", ")}.`);

  // Je Satz die Beträge vom Beleg übernehmen, nicht nachrechnen: die Steuer steht auf der Rechnung.
  const totals = {
    ...totalsOf(amounts, doc.reverseCharge),
    taxes: [...amounts].sort((a, b) => b.taxRate - a.taxRate).map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax })),
  };
  // Kleinunternehmer ziehen keine Vorsteuer ab; festgehalten am Beleg, damit spätere Auswertungen stimmen
  const vorsteuerAbzug = !company.kleinunternehmer;
  // Kleinunternehmer erwerben nur oberhalb der Erwerbsschwelle oder mit Option steuerpflichtig (§ 1a Abs. 3 und 4 UStG)
  if (doc.reverseCharge === "ig_erwerb" && company.kleinunternehmer) {
    throw new DocumentError("Innergemeinschaftlicher Erwerb als Kleinunternehmer (Erwerbsschwelle, § 1a Abs. 3 UStG) wird nicht unterstützt.");
  }
  // Anlage: auf das Anlagekonto statt in den Aufwand; ohne Vorsteuerabzug gehört die Steuer zu den Anschaffungskosten
  const asset = doc.category === "anlage" ? doc.asset : null;
  const assetAccountNo = asset ? assetAccount(asset.kind, asset.method, company.kontenrahmen) : undefined;
  // Aufgeteilt (#271): eine Buchung mit einer Aufwandszeile je Kategorie; sonst wie bisher über die Kategorie des Belegs
  const lines =
    splits.length > 0
      ? documentSplitPosting(totals, splitLines(splits), company.kontenrahmen, company.rechtsform, doc.payment, vorsteuerAbzug)
      : documentPosting(
          totals,
          doc.category as ExpenseCategory,
          company.kontenrahmen,
          company.rechtsform,
          doc.payment,
          vorsteuerAbzug,
          assetAccountNo,
          doc.privateShare,
          doc.reverseCharge,
        );
  const now = new Date();
  const entryId = await post(tx, company, {
    date: doc.documentDate!,
    description: `Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`,
    sourceType: "document",
    sourceId: id,
    lines,
  });
  // Bar aus der Kasse: Zeile im Kassenbuch; lehnt ab, wenn der Bestand dadurch negativ würde
  if (doc.payment === "kasse") {
    await addDocumentCashEntry(tx, {
      id,
      date: doc.documentDate!,
      gross: totals.gross,
      text: `${doc.supplierName}${doc.invoiceNumber ? ` · ${doc.invoiceNumber}` : ""}`,
      journalEntryId: entryId,
    });
  }
  await tx.update(schema.documents).set({ status: "gebucht", vorsteuerAbzug, lockedAt: now, updatedAt: now }).where(eq(schema.documents.id, id));
  if (asset) {
    await tx.insert(schema.assets).values({
      name: asset.name,
      kind: asset.kind,
      method: asset.method,
      account: assetAccountNo!,
      acquisitionDate: doc.documentDate!,
      cost: vorsteuerAbzug ? totals.net : totals.gross,
      ...documentAssetMethod(asset, doc.documentDate!),
      documentId: id,
    });
  }
}

/** Nur ungebuchte Belege lassen sich löschen; die Datei geht mit, solange sie sonst niemand nutzt. */
export async function deleteDocument(actor: string, id: string): Promise<void> {
  const { sha256, shared } = await withActor(actor, async (tx) => {
    const doc = await lockOpen(tx, id);
    await tx.delete(schema.documents).where(eq(schema.documents.id, id));
    return { sha256: doc.sha256, shared: await fileInUse(tx, doc.sha256) };
  });
  if (!shared) await removeFile(sha256);
}

export async function listDocuments() {
  return db
    .select({
      id: schema.documents.id,
      filename: schema.documents.filename,
      mimeType: schema.documents.mimeType,
      status: schema.documents.status,
      extractedBy: schema.documents.extractedBy,
      extractionStatus: schema.documents.extractionStatus,
      supplierName: schema.documents.supplierName,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      category: schema.documents.category,
      /** Zahl der Kontierungszeilen (#271); 0 = die Kategorie gilt für den ganzen Beleg */
      splitCount: sql<number>`(select count(*)::int from document_splits s where s.document_id = ${schema.documents.id})`,
      gross: schema.documents.gross,
      currency: schema.documents.currency,
      externalSource: schema.documents.externalSource,
      externalId: schema.documents.externalId,
      lockedAt: schema.documents.lockedAt,
      uploadedAt: schema.documents.uploadedAt,
      /** Aus einem Dauerbeleg angelegt */
      recurringDocumentId: schema.documents.recurringDocumentId,
      /** Storniert am (#237); der Beleg bleibt gebucht */
      cancelledOn: schema.documentCancellations.date,
    })
    .from(schema.documents)
    .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .orderBy(sql`${schema.documents.status} = 'gebucht'`, desc(schema.documents.documentDate), desc(schema.documents.uploadedAt));
}

/** Vorsteuer aus gebuchten Belegen eines Monats oder Quartals (nach Belegdatum), für Kz 66; ohne die vorgetragene aus einer Eröffnung */
export async function inputTaxForPeriod(period: VatPeriod): Promise<number> {
  const { start, end } = periodRange(period);
  const company = await loadCompany();
  const vorsteuer = Object.values(ACCOUNTS[company.kontenrahmen].vorsteuer);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)` })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(
      and(
        gte(schema.journalEntries.date, start),
        lt(schema.journalEntries.date, end),
        inArray(schema.journalLines.account, vorsteuer),
        ne(schema.journalEntries.sourceType, "eroeffnung"),
      ),
    );
  return Number(row?.total ?? 0);
}
