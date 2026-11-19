import { and, asc, sql } from "drizzle-orm";
import { bankAccountIncludedSql } from "../../db/bank-open.ts";
import { db, schema } from "../../db/index.ts";
import { csv, iso, money } from "./csv.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { KLAERUNGEN_HEADER, klaerungenFuerArchiv, QUELLEN_HEADER, quellenFuerArchiv } from "./export-importvertrag.ts";
import { berlinStart, yearEnd, yearStart } from "./jahr.ts";

/*
 * Bankimporte im Jahresarchiv: das Importprotokoll `bank/importe.csv` und, für Abrufe nach dem Importvertrag (#306), die
 * Herkunft der Umsätze `bank/quellen.csv` und die Klärungen von Konflikten `bank/klaerungen.csv`. export.ts bindet die
 * Datei ein; sie selbst nimmt von dort nur den Typ `ArchiveFile`.
 */

/**
 * Importe, die ins Archiv eines Jahres gehören: mit Umsätzen oder Zeitraum im Jahr, ohne Zeitraum nach dem Tag des Imports,
 * Lieferungen des Importvertrags, die einen Umsatz des Jahres verbunden haben (etwa vor ihrem Fenster, #306), und abgelehnte
 * Abrufe, deren Konflikt zu einem Umsatz des Jahres (bisheriger oder neuer) geklärt ist, damit `bank/quellen.csv` und `bank/klaerungen.csv` auf eine
 * Zeile von `bank/importe.csv` verweisen
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
          and t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)
        or exists (select 1 from import_conflicts c join import_resolutions r on r.conflict_id = c.id
          join import_movements m on m.id = c.movement_id join bank_transactions t on t.id = m.transaction_id
          left join bank_transactions n on n.id = r.transaction_id where c.bank_import_id = ${schema.bankImports.id}
          and (t.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date
            or n.booking_date between ${yearStart(year)}::date and ${yearEnd(year)}::date)))`,
        bankAccountIncludedSql("bank_account_id"),
      ),
    )
    .orderBy(asc(schema.bankImports.createdAt));
}

/**
 * Importprotokoll (`bank/importe.csv`), Herkunft der abgerufenen Umsätze (`bank/quellen.csv`) und Klärungen von Konflikten
 * (`bank/klaerungen.csv`) eines Jahres
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
  const quellen = await quellenFuerArchiv(year);
  if (quellen) yield { path: "bank/quellen.csv", content: csv(QUELLEN_HEADER, quellen), compress: true };
  const klaerungen = await klaerungenFuerArchiv(year);
  if (klaerungen) yield { path: "bank/klaerungen.csv", content: csv(KLAERUNGEN_HEADER, klaerungen), compress: true };
}
