import { and, eq, gte, lt, or } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { ArchiveFile } from "./export.ts";

/** Herkunft im Belegjahr, unabhängig vom Datum des technischen Imports. */
export async function* externalImportArchive(year: number): AsyncGenerator<ArchiveFile> {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  const rows = await db
    .select({ imported: schema.externalImports })
    .from(schema.externalImports)
    .leftJoin(schema.lexofficeVouchers, eq(schema.lexofficeVouchers.id, schema.externalImports.voucherId))
    .leftJoin(schema.legacyOrderDocuments, eq(schema.legacyOrderDocuments.id, schema.externalImports.orderDocumentId))
    .leftJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.externalImports.entryId))
    .where(
      or(
        and(gte(schema.lexofficeVouchers.date, from), lt(schema.lexofficeVouchers.date, to)),
        and(gte(schema.legacyOrderDocuments.date, from), lt(schema.legacyOrderDocuments.date, to)),
        and(gte(schema.journalEntries.date, from), lt(schema.journalEntries.date, to)),
      ),
    )
    .orderBy(schema.externalImports.source, schema.externalImports.kind, schema.externalImports.externalId);
  if (rows.length > 0)
    yield {
      path: "importe/uebernahmen.json",
      compress: true,
      content: new TextEncoder().encode(JSON.stringify({ version: 2, year, imports: rows.map((r) => r.imported) }, null, 2)),
    };
}
