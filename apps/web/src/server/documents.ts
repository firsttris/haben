import {
  ACCOUNTS,
  documentPosting,
  EXPENSE_CATEGORY_KEYS,
  type ExpenseCategory,
  type VatPeriod,
} from "@haben/core";
import { readEInvoice, type IncomingInvoice } from "@haben/einvoice";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { describeExtractionError, extractDocument, extractionAvailable, type ExtractedFields } from "./extraction.ts";
import { loadFile, removeFile, sniff, storeFile } from "./storage.ts";

export type Document = typeof schema.documents.$inferSelect;
export type DocumentAmount = typeof schema.documentAmounts.$inferSelect;

export class DocumentError extends Error {}

export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

const isoDate = z.iso.date();
const cents = z.number().int().min(-100_000_000_00).max(100_000_000_00);

export const documentInputSchema = z.object({
  supplierName: z.string().trim().max(200),
  supplierUstId: z.string().trim().max(20),
  invoiceNumber: z.string().trim().max(100),
  documentDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  category: z.enum(EXPENSE_CATEGORY_KEYS).nullable(),
  payment: z.enum(["bank", "privat"]),
  note: z.string().max(2000),
  amounts: z
    .array(z.object({ taxRate: z.union([z.literal(1900), z.literal(700), z.literal(0)]), net: cents, tax: cents }))
    .max(3)
    .refine((rows) => new Set(rows.map((r) => r.taxRate)).size === rows.length, "Jeder Steuersatz nur einmal"),
});

export type DocumentInput = z.infer<typeof documentInputSchema>;

function totalsOf(amounts: { taxRate: number; net: number; tax: number }[]) {
  const net = amounts.reduce((s, a) => s + a.net, 0);
  const tax = amounts.reduce((s, a) => s + a.tax, 0);
  return { net, tax, gross: net + tax };
}

/** Kategorie wie beim letzten gebuchten Beleg desselben Lieferanten */
async function guessCategory(supplierName: string, supplierUstId: string): Promise<ExpenseCategory | null> {
  if (!supplierName && !supplierUstId) return null;
  const [previous] = await db
    .select({ category: schema.documents.category })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        or(
          supplierUstId ? eq(schema.documents.supplierUstId, supplierUstId) : sql`false`,
          supplierName ? sql`lower(${schema.documents.supplierName}) = lower(${supplierName})` : sql`false`,
        ),
      ),
    )
    .orderBy(desc(schema.documents.lockedAt))
    .limit(1);
  return (previous?.category as ExpenseCategory | undefined) ?? null;
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
  if (invoice.currency !== "EUR") warnings.push(`Währung ${invoice.currency}: bitte in Euro umrechnen`);
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
  const totals = totalsOf(fields.amounts);
  await withActor(actor, async (tx) => {
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
    if (!doc || doc.lockedAt) return;
    await tx.delete(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
    if (fields.amounts.length > 0) {
      await tx.insert(schema.documentAmounts).values(fields.amounts.map((a) => ({ documentId: id, ...a })));
    }
    await tx
      .update(schema.documents)
      .set({
        supplierName: fields.supplierName,
        supplierUstId: fields.supplierUstId,
        invoiceNumber: fields.invoiceNumber,
        documentDate: fields.documentDate,
        dueDate: fields.dueDate,
        currency: fields.currency,
        category,
        ...totals,
        extractedBy,
        extractionStatus: "fertig",
        extractionError: fields.warnings.length > 0 ? fields.warnings.join(" · ") : null,
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
  duplicate: boolean;
}

/**
 * Legt einen Beleg ab. E-Rechnungen werden sofort gelesen; andere PDFs und Fotos
 * gehen an die KI-Auslesung im Hintergrund, falls eingerichtet.
 */
export async function uploadDocument(
  actor: string,
  file: { bytes: Uint8Array; filename: string },
  options: { background?: (work: Promise<void>) => void } = {},
): Promise<UploadResult> {
  if (file.bytes.byteLength === 0) throw new DocumentError(`${file.filename}: Die Datei ist leer.`);
  if (file.bytes.byteLength > MAX_DOCUMENT_SIZE) throw new DocumentError(`${file.filename}: größer als 20 MB.`);
  const type = sniff(file.bytes);
  if (!type) throw new DocumentError(`${file.filename}: Erlaubt sind PDF, JPEG, PNG, WebP, HEIC und E-Rechnungs-XML.`);

  const sha256 = await storeFile(file.bytes);
  const [existing] = await db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.sha256, sha256));
  if (existing) return { id: existing.id, duplicate: true };

  const id = await withActor(actor, async (tx) => {
    const [created] = await tx
      .insert(schema.documents)
      .values({ sha256, filename: file.filename.slice(0, 200), mimeType: type.mimeType, size: file.bytes.byteLength })
      .onConflictDoNothing({ target: schema.documents.sha256 })
      .returning({ id: schema.documents.id });
    return created?.id ?? null;
  });
  if (!id) {
    const [again] = await db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.sha256, sha256));
    return { id: again!.id, duplicate: true };
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
        await setExtractionState(actor, id, "fehler", error instanceof Error ? error.message : "XML nicht lesbar");
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

async function lockOpen(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string): Promise<Document> {
  const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
  if (!doc) throw new DocumentError("Beleg nicht gefunden.");
  if (doc.lockedAt) throw new DocumentError("Der Beleg ist gebucht und kann nicht mehr geändert werden.");
  return doc;
}

export async function updateDocument(actor: string, id: string, input: DocumentInput): Promise<void> {
  await withActor(actor, async (tx) => {
    await lockOpen(tx, id);
    await tx.delete(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
    if (input.amounts.length > 0) {
      await tx.insert(schema.documentAmounts).values(input.amounts.map((a) => ({ documentId: id, ...a })));
    }
    const { amounts, ...fields } = input;
    await tx
      .update(schema.documents)
      .set({
        ...fields,
        supplierUstId: fields.supplierUstId.replace(/\s/g, "").toUpperCase(),
        ...totalsOf(amounts),
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, id));
  });
}

export async function getDocument(id: string) {
  let [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!doc) return null;
  if (doc.extractionStatus === "laeuft" && !runningExtractions.has(id)) {
    // Server während der Auslesung neu gestartet: Beleg wieder freigeben statt ewig „läuft“
    [doc] = await db
      .update(schema.documents)
      .set({ extractionStatus: "fehler", extractionError: "Die Auslesung wurde unterbrochen. Bitte erneut auslesen oder von Hand ausfüllen." })
      .where(and(eq(schema.documents.id, id), eq(schema.documents.extractionStatus, "laeuft"), sql`${schema.documents.lockedAt} is null`))
      .returning();
    [doc] = doc ? [doc] : await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc) return null;
  }
  const amounts = await db
    .select()
    .from(schema.documentAmounts)
    .where(eq(schema.documentAmounts.documentId, id))
    .orderBy(desc(schema.documentAmounts.taxRate));
  return { document: doc, amounts };
}

/** Was vor dem Buchen fehlt; leere Liste = bereit */
export function bookingIssues(doc: Document, amounts: DocumentAmount[]): string[] {
  const issues: string[] = [];
  if (!doc.supplierName) issues.push("Lieferant fehlt");
  if (!doc.documentDate) issues.push("Belegdatum fehlt");
  if (!doc.category) issues.push("Kategorie fehlt");
  if (doc.currency !== "EUR") issues.push("Nur Belege in Euro können gebucht werden");
  if (amounts.length === 0 || amounts.every((a) => a.net === 0 && a.tax === 0)) issues.push("Beträge fehlen");
  return issues;
}

/** Bucht den Beleg (Aufwand + Vorsteuer an Verbindlichkeiten bzw. Privateinlage) und sperrt ihn. */
export async function bookDocument(actor: string, id: string): Promise<void> {
  const company = await loadCompany();
  await withActor(actor, async (tx) => {
    const doc = await lockOpen(tx, id);
    const amounts = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
    const issues = bookingIssues(doc, amounts);
    if (issues.length > 0) throw new DocumentError(`Noch nicht bereit: ${issues.join(", ")}.`);

    // Je Satz die Beträge vom Beleg übernehmen, nicht nachrechnen: die Steuer steht auf der Rechnung.
    const totals = {
      ...totalsOf(amounts),
      taxes: [...amounts].sort((a, b) => b.taxRate - a.taxRate).map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax })),
    };
    const lines = documentPosting(totals, doc.category as ExpenseCategory, company.kontenrahmen, doc.payment);
    const now = new Date();
    const [entry] = await tx
      .insert(schema.journalEntries)
      .values({
        date: doc.documentDate!,
        description: `Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplierName}`,
        sourceType: "document",
        sourceId: id,
        kontenrahmen: company.kontenrahmen,
      })
      .returning();
    await tx.insert(schema.journalLines).values(lines.map((line) => ({ entryId: entry!.id, ...line })));
    await tx.update(schema.journalEntries).set({ lockedAt: now }).where(eq(schema.journalEntries.id, entry!.id));
    await tx
      .update(schema.documents)
      .set({ status: "gebucht", lockedAt: now, updatedAt: now })
      .where(eq(schema.documents.id, id));
  });
}

/**
 * Nur ungebuchte Belege lassen sich löschen; die Datei geht mit, außer Archiv oder Lexoffice-Übernahme
 * nutzen dieselbe Datei (Ablage nach Inhalt, also derselbe SHA-256).
 */
export async function deleteDocument(actor: string, id: string): Promise<void> {
  const { sha256, shared } = await withActor(actor, async (tx) => {
    const doc = await lockOpen(tx, id);
    await tx.delete(schema.documents).where(eq(schema.documents.id, id));
    const [use] = await tx.execute<{ shared: boolean }>(sql`
      select exists (select 1 from archive_files where sha256 = ${doc.sha256})
          or exists (select 1 from lexoffice_voucher_files where sha256 = ${doc.sha256}) as shared`);
    return { sha256: doc.sha256, shared: Boolean(use?.shared) };
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
      gross: schema.documents.gross,
      uploadedAt: schema.documents.uploadedAt,
    })
    .from(schema.documents)
    .orderBy(sql`${schema.documents.status} = 'gebucht'`, desc(schema.documents.documentDate), desc(schema.documents.uploadedAt));
}

/** Vorsteuer aus gebuchten Belegen eines Monats (nach Belegdatum), für Kz 66 */
export async function inputTaxForPeriod({ year, month }: VatPeriod): Promise<number> {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
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
      ),
    );
  return Number(row?.total ?? 0);
}
