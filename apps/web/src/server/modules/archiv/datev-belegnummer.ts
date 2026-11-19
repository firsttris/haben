import { AUFLADUNG } from "@haben/core";
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

/** Die GUID aus einem Beleglink `BEDI "<guid>"`, sonst null */
function linkGuid(linkField: string): SQL {
  return sql.raw(`substring(${linkField} from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')`);
}

/**
 * Accountable hängt an jede Buchung einen Beleglink `BEDI "<guid>"` und legt den Beleg unter derselben
 * GUID ab. Eine Rechnung kann mehrere Buchungszeilen haben (Hauptbetrag, Versand, Kleinteile); nur die
 * erste Zeile trägt dann die Belegnummer. Über die GUID finden auch die übrigen Zeilen ihren Beleg.
 * Ebenso die Belege aus der Export-ZIP von sevDesk (#1106): Schlüssel ist dort die GUID aus dem Beleglink.
 */
export function datevGuidFound(linkField: string): SQL<boolean> {
  const guid = linkGuid(linkField);
  return sql<boolean>`(${guid} is not null and exists (
    select 1 from lexoffice_vouchers g
     where g.source in ('accountable', 'sevdesk-export') and lower(g.raw->>'guid') = lower(${guid})))`;
}

/**
 * Buchung mit Beleglink aus einem Stapel der Export-ZIP von sevDesk, in einem Jahr, für das der Lauf Belege angelegt hat
 * (nicht in den Jahren mit Belegen aus der API, sevdesk-export-lauf.ts). Sie findet ihren Beleg nur über die GUID: Zwei
 * Belege können dieselbe Nummer tragen (#1106), dann zählte die Nummer auch die Buchung des fehlenden als gefunden.
 */
function sevdeskExportLinked(linkField: string, fileField: string, dateField: string): SQL<boolean> {
  const file = sql.raw(fileField);
  const date = sql.raw(dateField);
  return sql<boolean>`(${linkGuid(linkField)} is not null and exists (
    select 1 from lexoffice_imports i
     where i.source = 'sevdesk-export'
       and coalesce(i.progress->'sevdeskExport'->'stackFileIds', '[]'::jsonb) ? (${file}::text)
       and not coalesce(i.progress->'sevdeskExport'->'apiYears', '[]'::jsonb) @> to_jsonb(extract(year from ${date})::int)))`;
}

/**
 * Findet die Buchung ihren Beleg? Über die Belegnummer oder die GUID im Beleglink; Buchungen mit Beleglink aus der
 * Export-ZIP von sevDesk nur über die GUID. Zahlungen ohne Beleglink finden ihren Beleg weiter über die Nummer.
 */
export function datevBookingFound(fields: { number: string; link: string; file: string; date: string }): SQL<boolean> {
  return sql<boolean>`(case when ${sevdeskExportLinked(fields.link, fields.file, fields.date)} then ${datevGuidFound(fields.link)}
    else ${datevVoucherFound(fields.number)} or ${datevGuidFound(fields.link)} end)`;
}

/**
 * Buchungen, die nie einen Eingangsbeleg haben: Privat, Geldtransit und Vortragskonten (Klasse 9), je nach Kontenrahmen
 * (packages/core/src/kontenplan.ts: SKR03 Privat 1800–1899 und Geldtransit 1360, SKR04 Privat 2100–2199 und Geldtransit
 * 1460; in SKR04 ist 1800 die Bank). Dazu die Erlöse, aber nur in einem Stapel aus dem Accountable-Umzug: Accountable
 * exportiert keine Ausgangsrechnungen, aus Lexoffice und sevDesk fehlt eine Rechnung zur Erlösbuchung dagegen wirklich. Das
 * gilt auch für die Export-ZIP von sevDesk: Sie enthält die Ausgangsrechnungen (#1106).
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

/**
 * Zeile einer Aufladung eines Guthabens (#1356) im DATEV-Stapel: Für die Aufladung selbst gibt es keine Rechnung, Haben
 * stellt deshalb „Aufladung Guthaben“ an den Anfang ihres Buchungstexts (die Stelle, die auch ein gekürzter Text behält).
 * Sie ist keine Ausnahme ohne Beleg wie Privat und Geldtransit, sondern eine Ausnahme mit eigenem Grund: Mit der späteren
 * Rechnung bekommt sie ihren Bezug. Bis dahin zählt sie weder als offener Punkt noch als erledigt.
 */
export function datevAufladung(textField: string): SQL<boolean> {
  const text = sql.raw(textField);
  return sql<boolean>`coalesce(${text} like ${`${AUFLADUNG.text}%`}, false)`;
}

/**
 * Ein gefülltes Belegfeld 1 ohne eine einzige Ziffer trägt keine Belegnummer (#1355): Zahlungsdienstleister schreiben
 * dort ihren Namen oder ein Kürzel hinein, nicht eine Rechnungsnummer. Ein Feld mit Ziffer gilt als Nummer, auch wenn
 * sie nicht vollständig ist. Kein Namensraten: Die Prüfung ist strukturell und gilt damit auch für Anbieter, die es
 * heute noch nicht gibt.
 *
 * DATEV erlaubt in Feld 11 auch reine Buchstabenfolgen (ASCII-Import, Feldbeschreibungen für Standardformate, Dok.-Nr.
 * 1003221); dass ein Feld ohne Ziffer keine Nummer ist, ist deshalb eine Regel aus #1355 und keine Vorgabe von DATEV.
 */
export function datevOhneBelegnummer(field: string): SQL<boolean> {
  const f = sql.raw(field);
  return sql<boolean>`(btrim(${f}) <> '' and ${f} !~ '[0-9]')`;
}

/** Felder einer Buchung des DATEV-Stapels, so qualifiziert wie in der Abfrage (`b.voucher_field1` oder `datev_bookings.…`). */
export interface DatevBookingFields {
  number: string;
  link: string;
  file: string;
  date: string;
  contra: string;
}

/**
 * Die Buchung ist ohne Beleg offen: keiner der drei Wege greift, also kein Beleg zur Nummer oder GUID, keine interne
 * Kennung und kein Konto ohne Belegpflicht. Liste und Abgleich teilen diese eine Definition, damit sie ein Belegfeld
 * ohne Nummer gleich einordnen (#1355).
 */
export function datevOpenBooking(fields: DatevBookingFields, kontenrahmen: "SKR03" | "SKR04"): SQL<boolean> {
  return sql<boolean>`(not ${datevBookingFound(fields)} and not ${datevInternalId(fields.number)}
    and not ${datevWithoutReceipt(kontenrahmen, fields.contra, fields.file)})`;
}

/**
 * Offene Buchung, deren Belegfeld 1 keine Nummer trägt: Sie ist kein offener Punkt, sondern zählt wie ein leeres Feld
 * unter „ohne Belegnummer“ (#1355). Trägt ein Beleg das Feld trotzdem als Nummer, greift `datevOpenBooking` nicht und es
 * bleibt beim Fund.
 */
export function datevFieldWithoutNumber(fields: DatevBookingFields, kontenrahmen: "SKR03" | "SKR04"): SQL<boolean> {
  return sql<boolean>`(${datevOpenBooking(fields, kontenrahmen)} and ${datevOhneBelegnummer(fields.number)})`;
}
