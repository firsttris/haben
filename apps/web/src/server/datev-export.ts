import { buildDatevBuchungsstapel, type DatevExportEntry } from "@haben/import";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

/** DATEV-Buchungsstapel eines Jahres für die Steuerberatung */

export class DatevExportError extends Error {}

export const datevNumbersSchema = z.object({
  beraterNr: z.string().trim().regex(/^\d{4,7}$/, "Die Beraternummer hat 4 bis 7 Ziffern."),
  mandantNr: z.string().trim().regex(/^\d{1,5}$/, "Die Mandantennummer hat 1 bis 5 Ziffern."),
});

export async function saveDatevNumbers(actor: string, input: z.input<typeof datevNumbersSchema>): Promise<void> {
  const { beraterNr, mandantNr } = datevNumbersSchema.parse(input);
  await withActor(actor, (tx) => tx.update(schema.company).set({ datevBeraterNr: beraterNr, datevMandantNr: mandantNr }).where(eq(schema.company.id, 1)));
}

/** Belegfeld 1: Rechnungsnummer bzw. Belegnummer des Lieferanten, soweit bekannt */
async function vouchers(entries: (typeof schema.journalEntries.$inferSelect)[]): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(entries.filter((e) => e.sourceType === type).map((e) => e.sourceId))];
  const result = new Map<string, string>();
  const invoiceIds = ids("invoice");
  const documentIds = ids("document");
  const allocationIds = ids("allocation");
  const allocations = allocationIds.length
    ? await db
        .select({ id: schema.allocations.id, invoiceId: schema.allocations.invoiceId, documentId: schema.allocations.documentId })
        .from(schema.allocations)
        .where(inArray(schema.allocations.id, allocationIds))
    : [];
  const allInvoiceIds = [...new Set([...invoiceIds, ...allocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : []))])];
  const allDocumentIds = [...new Set([...documentIds, ...allocations.flatMap((a) => (a.documentId ? [a.documentId] : []))])];
  const invoices = allInvoiceIds.length
    ? await db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices).where(inArray(schema.invoices.id, allInvoiceIds))
    : [];
  const documents = allDocumentIds.length
    ? await db
        .select({ id: schema.documents.id, number: schema.documents.invoiceNumber })
        .from(schema.documents)
        .where(inArray(schema.documents.id, allDocumentIds))
    : [];
  const numbers = new Map([...invoices, ...documents].map((r) => [r.id, r.number ?? ""]));
  for (const a of allocations) result.set(a.id, numbers.get(a.invoiceId ?? a.documentId ?? "") ?? "");
  for (const id of [...invoiceIds, ...documentIds]) result.set(id, numbers.get(id) ?? "");
  return result;
}

export async function datevExport(year: number, now = new Date()): Promise<{ bytes: Uint8Array; filename: string; bookings: number }> {
  const company = await loadCompany();
  if (!company.datevBeraterNr || !company.datevMandantNr) throw new DatevExportError("Berater- und Mandantennummer fehlen.");
  const entries = await db
    .select()
    .from(schema.journalEntries)
    .where(and(gte(schema.journalEntries.date, `${year}-01-01`), lte(schema.journalEntries.date, `${year}-12-31`)))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.createdAt), asc(schema.journalEntries.id));
  if (entries.some((e) => e.kontenrahmen !== company.kontenrahmen)) {
    throw new DatevExportError(`Im Jahr ${year} gibt es Buchungen in einem anderen Kontenrahmen als ${company.kontenrahmen}.`);
  }
  const lines = entries.length
    ? await db
        .select()
        .from(schema.journalLines)
        .where(
          inArray(
            schema.journalLines.entryId,
            entries.map((e) => e.id),
          ),
        )
    : [];
  const byEntry = new Map<string, typeof lines>();
  for (const line of lines) byEntry.set(line.entryId, [...(byEntry.get(line.entryId) ?? []), line]);
  const voucherOf = await vouchers(entries);
  const exportEntries: DatevExportEntry[] = entries.map((e) => ({
    date: e.date,
    description: e.description,
    voucher: voucherOf.get(e.sourceId) ?? "",
    locked: e.lockedAt !== null,
    lines: (byEntry.get(e.id) ?? []).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
  }));
  const { bytes, rows } = buildDatevBuchungsstapel(
    {
      beraterNr: company.datevBeraterNr,
      mandantNr: company.datevMandantNr,
      fiscalYearStart: `${year}-01-01`,
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
      description: `Haben ${year}`,
      kontenrahmen: company.kontenrahmen,
      createdAt: now,
    },
    exportEntries,
  );
  return { bytes, filename: `EXTF_Buchungsstapel_${year}.csv`, bookings: rows.length };
}
