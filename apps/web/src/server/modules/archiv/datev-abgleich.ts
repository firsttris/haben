import { sql } from "drizzle-orm";
import { ohneJit } from "../../db/ohne-jit.ts";
import { datevFieldWithoutNumber, datevInternalId, datevOpenBooking, type DatevBookingFields } from "./datev-belegnummer.ts";

/** Felder einer Buchung des DATEV-Stapels unter dem Alias `b`, wie Abgleich und Liste sie prüfen (#1355) */
const STACK_FIELDS: DatevBookingFields = {
  number: "b.voucher_field1",
  link: "b.document_link",
  file: "b.file_id",
  date: "b.date",
  contra: "b.contra_account",
};

/** Zahlen einer Buchungszeile im Abgleich: gefunden, offen, ohne Belegnummer */
export interface DatevBookingCounts {
  total: number;
  unmatched: number;
  withoutNumber: number;
}

/**
 * Zählung der Buchungen des DATEV-Stapels je Jahr für den Abgleich. `unmatched` ist offen im Sinne von
 * `datevOpenBooking`, aber mit gefülltem Belegfeld; `withoutNumber` sind die Buchungen ohne Belegnummer: leeres Feld,
 * interne Kennung von sevDesk oder ein Belegfeld ohne eine einzige Ziffer (#1355). Ein Belegfeld ohne Ziffer zählt dabei
 * wie ein leeres Feld und ist kein offener Punkt.
 *
 * Ohne JIT: Die Filter fragen je Zeile Belege und Kontoart ab, die geschätzten Kosten liegen weit über der Ausführung
 * (docs/entwicklung.md, „Abgleich je Jahr“).
 */
export async function datevBookingCounts(kontenrahmen: "SKR03" | "SKR04"): Promise<Map<number, DatevBookingCounts>> {
  const open = datevOpenBooking(STACK_FIELDS, kontenrahmen);
  const fieldWithoutNumber = datevFieldWithoutNumber(STACK_FIELDS, kontenrahmen);
  const rows = await ohneJit((tx) =>
    tx.execute<{
      year: number;
      total: number;
      unmatched: number;
      without_number: number;
    }>(sql`
    select extract(year from b.date)::int as year, count(*)::int as total,
      count(*) filter (where b.voucher_field1 <> '' and ${open} and not ${fieldWithoutNumber})::int as unmatched,
      count(*) filter (where b.voucher_field1 = '' or ${datevInternalId("b.voucher_field1")} or ${fieldWithoutNumber})::int as without_number
    from datev_bookings b group by 1`),
  );
  return new Map(
    rows.map((row) => [
      Number(row.year),
      {
        total: row.total,
        unmatched: row.unmatched,
        withoutNumber: row.without_number,
      },
    ]),
  );
}

/**
 * Detailtext der Prüfung „Jede Buchung mit Belegnummer findet ihren Beleg“. Buchungen ohne Belegnummer brauchen nicht
 * immer einen Beleg: leere Felder, interne Kennungen von sevDesk und Belegfelder ohne eine einzige Ziffer stehen nur
 * als Zahl daneben (#1355).
 */
export function bookingsCheckDetail(bookings: DatevBookingCounts): string {
  return [
    bookings.unmatched === 0 ? "alle gefunden" : `${bookings.unmatched} ohne passenden Beleg`,
    bookings.withoutNumber > 0 ? `${bookings.withoutNumber} ohne Belegnummer` : "",
  ]
    .filter(Boolean)
    .join(", ");
}
