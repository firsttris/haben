import { sql, type SQL } from "drizzle-orm";

/** Belegfeld 1 fasst 36 Zeichen; sevDesk schreibt von längeren Nummern die letzten 36 hinein (#472). */
const BELEGFELD_LENGTH = 36;

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const normalized = (text: string) => `lower(regexp_replace(${text}, '\\s+', '', 'g'))`;

/**
 * Die letzten 36 Zeichen der Nummer ergeben den Wert. Ob sevDesk Leerzeichen vor oder nach dem Kürzen entfernt, ist nicht
 * belegt: Das Beispiel aus #472 passt nur, wenn sie vorher wegfallen. Der DATEV-Parser schneidet außerdem ein Leerzeichen
 * am Anfang des Felds ab; ohne Leerzeichen zu vergleichen deckt das mit ab.
 */
export function truncatedNumberMatches(alias: string, value: SQL): SQL<boolean> {
  const table = sql.raw(alias);
  const length = sql.raw(String(BELEGFELD_LENGTH));
  const wanted = sql`lower(regexp_replace(${value}, '\\s+', '', 'g'))`;
  return sql<boolean>`(${table}.source = 'sevdesk' and length(${table}.number) > ${length} and (
    lower(regexp_replace(right(${table}.number, ${length}), '\\s+', '', 'g')) = ${wanted}
    or lower(right(regexp_replace(${table}.number, '\\s+', '', 'g'), ${length})) = ${wanted}))`;
}

/** Gibt es zur Belegnummer der Buchung einen Beleg? Ohne Leerzeichen, Groß-/Kleinschreibung egal. */
export function datevVoucherFound(field: string): SQL<boolean> {
  const exact = sql.raw(`${normalized("v.number")} = ${normalized(field)}`);
  return sql<boolean>`exists (select 1 from lexoffice_vouchers v where v.number <> '' and (${exact} or ${truncatedNumberMatches("v", sql.raw(field))}))`;
}

/**
 * sevDesk schreibt in Zahlungsbuchungen eine interne UUID ins Belegfeld (#472): keine Belegnummer, außer ein Beleg trägt
 * sie wirklich als Nummer.
 */
export function datevInternalId(field: string): SQL<boolean> {
  const uuid = sql.raw(`${field} ~* '${UUID_PATTERN}' and exists (select 1 from lexoffice_vouchers s where s.source = 'sevdesk')`);
  return sql<boolean>`(${uuid} and not ${datevVoucherFound(field)})`;
}
