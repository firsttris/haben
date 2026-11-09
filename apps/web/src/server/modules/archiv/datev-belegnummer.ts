import { sql, type SQL } from "drizzle-orm";

/** Belegfeld 1 fasst 36 Zeichen; sevDesk schreibt von längeren Nummern die letzten 36 hinein (#472). */
const BELEGFELD_LENGTH = 36;

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const normalized = (text: string) => `lower(regexp_replace(${text}, '\\s+', '', 'g'))`;

/** Gibt es zur Belegnummer der Buchung einen Beleg? Ohne Leerzeichen, Groß-/Kleinschreibung egal. */
export function datevVoucherFound(field: string): SQL<boolean> {
  return sql.raw(`exists (select 1 from lexoffice_vouchers v where v.number <> '' and (${normalized("v.number")} = ${normalized(field)}
    or (v.source = 'sevdesk' and length(v.number) > ${BELEGFELD_LENGTH} and length(${field}) = ${BELEGFELD_LENGTH}
      and ${normalized(`right(v.number, ${BELEGFELD_LENGTH})`)} = ${normalized(field)})))`) as SQL<boolean>;
}

/** sevDesk schreibt in Zahlungsbuchungen eine interne UUID ins Belegfeld (#472): keine Belegnummer, die einen Beleg finden könnte. */
export function datevInternalId(field: string): SQL<boolean> {
  return sql.raw(`(${field} ~* '${UUID_PATTERN}' and exists (select 1 from lexoffice_vouchers s where s.source = 'sevdesk'))`) as SQL<boolean>;
}
