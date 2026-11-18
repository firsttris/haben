import { and, asc, sql } from "drizzle-orm";
import { bankAccountIncludedSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
import { type ArchiveFile, berlinStart, csv, iso, money, yearEnd, yearStart } from "./export.ts";
import { QUELLEN_HEADER, quellenFuerArchiv } from "./export-importvertrag.ts";

/*
 * Bankimporte im Jahresarchiv: das Importprotokoll `bank/importe.csv` und, für Abrufe nach dem Importvertrag (#306), die
 * Herkunft der Umsätze `bank/quellen.csv`.
 */

/**
 * Importe, die ins Archiv eines Jahres gehören: mit Umsätzen oder Zeitraum im Jahr, ohne Zeitraum nach dem Tag des Imports,
 * und Lieferungen des Importvertrags, die einen Umsatz des Jahres verbunden haben (etwa vor ihrem Fenster, #306), damit
 * `bank/quellen.csv` auf eine Zeile von `bank/importe.csv` verweist
 */
export function importsOfYear(year: number) {
  return db
    .select()
    .from(schema.bankImports)
    .where(
      and(
        sql`(exists (select 1 from bank_transactions t where t.import_id = ${schema.bankImports.id}
          and t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)
        or (${schema.bankImports.periodFrom} <= ${yearEnd(year)}::date and ${schema.bankImports.periodTo} >= ${yearStart(year)}::date)
        or (${schema.bankImports.periodTo} is null and ${schema.bankImports.createdAt} >= ${berlinStart(year)}
          and ${schema.bankImports.createdAt} < ${berlinStart(year + 1)})
        or exists (select 1 from import_batches b join import_movements m on m.batch_id = b.id
          join bank_transactions t on t.id = m.transaction_id where b.bank_import_id = ${schema.bankImports.id}
          and t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date))`,
        bankAccountIncludedSql("bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankImports.createdAt));
}

/**
 * Importprotokoll (`bank/importe.csv`) und Herkunft der abgerufenen Umsätze (`bank/quellen.csv`) eines Jahres
 */
export async function* bankImportFiles(
  year: number,
  imports: (typeof schema.bankImports.$inferSelect)[],
  accountById: ReadonlyMap<string, { iban: string | null; name: string }>,
): AsyncGenerator<ArchiveFile> {
  yield {
    path: "bank/importe.csv",
    content: csv(
      [
        "Konto",
        "Datei",
        "SHA-256",
        "Format",
        "Zeitraum von",
        "Zeitraum bis",
        "Anfangssaldo",
        "Endsaldo",
        "Neu",
        "Übersprungen",
        "Hinweise",
        "Importiert",
        "Import-ID",
      ],
      imports.map((i) => [
        accountById.get(i.bankAccountId)?.iban ?? accountById.get(i.bankAccountId)?.name,
        i.filename,
        i.sha256,
        i.format,
        i.periodFrom,
        i.periodTo,
        money(i.openingBalance),
        money(i.closingBalance),
        i.added,
        i.skipped,
        i.warnings.join(" | "),
        iso(i.createdAt),
        i.id,
      ]),
    ),
    compress: true,
  };
  // Herkunft der abgerufenen Umsätze nach dem Importvertrag (#306): eigene Datei, siehe export-importvertrag.ts
  const quellen = await quellenFuerArchiv({ von: yearStart(year), bis: yearEnd(year), money, iso });
  if (quellen) yield { path: "bank/quellen.csv", content: csv(QUELLEN_HEADER, quellen), compress: true };
}
