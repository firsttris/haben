import { sql, type SQL } from "drizzle-orm";

/** Belegfeld 1 fasst 36 Zeichen; sevDesk schreibt von längeren Nummern die letzten 36 hinein (#472). */
const BELEGFELD_LENGTH = 36;

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const normalized = (text: string) => `lower(regexp_replace(${text}, '\\s+', '', 'g'))`;

/** Die letzten 36 Zeichen der Nummer ergeben den Wert; der DATEV-Parser schneidet ein Leerzeichen am Anfang ab. */
export function truncatedNumberMatches(alias: string, value: SQL): SQL<boolean> {
  const table = sql.raw(alias);
  const length = sql.raw(String(BELEGFELD_LENGTH));
  return sql<boolean>`(${table}.source = 'sevdesk' and length(${table}.number) > ${length}
    and lower(regexp_replace(right(${table}.number, ${length}), '\\s+', '', 'g')) = lower(regexp_replace(${value}, '\\s+', '', 'g')))`;
}

/** Gibt es zur Belegnummer der Buchung einen Beleg? Ohne Leerzeichen, Groß-/Kleinschreibung egal. */
export function datevVoucherFound(field: string): SQL<boolean> {
  const exact = sql.raw(`${normalized("v.number")} = ${normalized(field)}`);
  return sql<boolean>`exists (select 1 from lexoffice_vouchers v where v.number <> '' and (${exact} or ${truncatedNumberMatches("v", sql.raw(field))}))`;
}

/** sevDesk schreibt in Zahlungsbuchungen eine interne UUID ins Belegfeld (#472): keine Belegnummer, die einen Beleg finden könnte. */
export function datevInternalId(field: string): SQL<boolean> {
  return sql.raw(`(${field} ~* '${UUID_PATTERN}' and exists (select 1 from lexoffice_vouchers s where s.source = 'sevdesk'))`) as SQL<boolean>;
}
