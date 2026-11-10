import { and, eq, gte, lt, or } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { ArchiveFile } from "./export.ts";

/** Quellstand und Zahlungsnachweise gehören ins Belegjahr, auch bei einer späteren Übernahme. */
export async function* externalImportArchive(year: number): AsyncGenerator<ArchiveFile> {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  const rows = await db
    .select({ imported: schema.externalImports })
    .from(schema.externalImports)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.externalImports.invoiceId))
    .leftJoin(schema.quotes, eq(schema.quotes.id, schema.externalImports.quoteId))
    .leftJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.externalImports.entryId))
    .where(
      or(
        and(gte(schema.invoices.issueDate, from), lt(schema.invoices.issueDate, to)),
        and(gte(schema.quotes.issueDate, from), lt(schema.quotes.issueDate, to)),
        and(gte(schema.journalEntries.date, from), lt(schema.journalEntries.date, to)),
      ),
    )
    .orderBy(schema.externalImports.source, schema.externalImports.kind, schema.externalImports.externalId);
  if (rows.length === 0) return;
  yield {
    path: "importe/uebernahmen.json",
    content: new TextEncoder().encode(JSON.stringify({ version: 1, year, imports: rows.map((row) => row.imported) }, null, 2)),
    compress: true,
  };
}
