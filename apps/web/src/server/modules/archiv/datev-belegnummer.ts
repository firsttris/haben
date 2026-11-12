import { sql, type SQL } from "drizzle-orm";

/** Belegfeld 1 fasst 36 Zeichen; sevDesk schreibt von längeren Nummern die letzten 36 hinein (#472). */
const BELEGFELD_LENGTH = 36;

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const normalized = (text: string) => `lower(regexp_replace(${text}, '\\s+', '', 'g'))`;

/**
 * sevDesk entfernt alle Zeichen außerhalb des Zeichensatzes von Belegfeld 1, belegt für Punkt und Umlaute (#472), dann
 * bleiben die letzten 36. Die übrigen Fälle prüfen, ob nur Leerzeichen fehlen.
 *
 * Die letzten 36 Zeichen der Nummer ergeben den Wert. Ob sevDesk Leerzeichen vor oder nach dem Kürzen entfernt, ist nicht
 * belegt: Das Beispiel aus #472 passt nur, wenn sie vorher wegfallen. Der DATEV-Parser schneidet außerdem ein Leerzeichen
 * am Anfang des Felds ab; ohne Leerzeichen zu vergleichen deckt das mit ab.
 */
export function truncatedNumberMatches(alias: string, value: SQL): SQL<boolean> {
  const table = sql.raw(alias);
  const length = sql.raw(String(BELEGFELD_LENGTH));
  const wanted = sql`lower(regexp_replace(${value}, '\\s+', '', 'g'))`;
  return sql<boolean>`(${table}.source = 'sevdesk' and (
    lower(right(regexp_replace(${table}.number, '[^0-9A-Za-z$&%*+/-]', '', 'g'), ${length})) = ${wanted}
    or (length(${table}.number) > ${length} and (
      lower(regexp_replace(right(${table}.number, ${length}), '\\s+', '', 'g')) = ${wanted}
      or lower(right(regexp_replace(${table}.number, '\\s+', '', 'g'), ${length})) = ${wanted}))))`;
}

/** Gibt es zur Belegnummer der Buchung einen Beleg? Ohne Leerzeichen, Groß-/Kleinschreibung egal. */
export function datevVoucherFound(field: string): SQL<boolean> {
  const exact = sql.raw(`${normalized("v.number")} = ${normalized(field)}`);
  return sql<boolean>`exists (select 1 from lexoffice_vouchers v where v.number <> '' and (${exact} or ${truncatedNumberMatches("v", sql.raw(field))}))`;
}

/**
 * Accountable hängt an jede Buchung einen Beleglink `BEDI "<guid>"` und legt den Beleg unter derselben
 * GUID ab. Eine Rechnung kann mehrere Buchungszeilen haben (Hauptbetrag, Versand, Kleinteile); nur die
 * erste Zeile trägt dann die Belegnummer. Über die GUID finden auch die übrigen Zeilen ihren Beleg.
 */
export function datevGuidFound(linkField: string): SQL<boolean> {
  const pattern = "'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'";
  const guid = sql.raw(`substring(${linkField} from ${pattern})`);
  return sql<boolean>`(${guid} is not null and exists (
    select 1 from lexoffice_vouchers g
     where g.source = 'accountable' and lower(g.raw->>'guid') = lower(${guid})))`;
}

/**
 * Buchungen, die nie einen Eingangsbeleg haben: Privat, Geldtransit und Vortragskonten (Klasse 9), je nach Kontenrahmen
 * (packages/core/src/posting.ts: SKR03 Privat 1800–1899 und Geldtransit 1360, SKR04 Privat 2100–2199 und Geldtransit
 * 1460; in SKR04 ist 1800 die Bank). Dazu die Erlöse, aber nur in einem Stapel aus dem Accountable-Umzug: Accountable
 * exportiert keine Ausgangsrechnungen, aus Lexoffice und sevDesk fehlt eine Rechnung zur Erlösbuchung dagegen wirklich.
 */
export function datevWithoutReceipt(kontenrahmen: "SKR03" | "SKR04", contraField: string, fileField: string): SQL<boolean> {
  const neutral = kontenrahmen === "SKR04" ? "^(21[0-9]{2}|1460|9[0-9]{3})$" : "^(18[0-9]{2}|1360|9[0-9]{3})$";
  const revenue = kontenrahmen === "SKR04" ? "^4[0-9]{3}$" : "^8[0-9]{3}$";
  const contra = sql.raw(contraField);
  const file = sql.raw(fileField);
  return sql<boolean>`(${contra} ~ ${neutral} or (${contra} ~ ${revenue} and exists (
    select 1 from lexoffice_imports i
     where i.source = 'accountable' and i.progress->'accountable'->>'archivedFileId' = ${file}::text)))`;
}

/**
 * sevDesk schreibt in Zahlungsbuchungen eine interne UUID ins Belegfeld (#472): keine Belegnummer, außer ein Beleg trägt
 * sie wirklich als Nummer.
 */
export function datevInternalId(field: string): SQL<boolean> {
  const uuid = sql.raw(`${field} ~* '${UUID_PATTERN}' and exists (select 1 from lexoffice_vouchers s where s.source = 'sevdesk')`);
  return sql<boolean>`(${uuid} and not ${datevVoucherFound(field)})`;
}
