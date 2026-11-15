/*
 * Beschreibungsdatei (index.xml) nach dem Beschreibungsstandard der Finanzverwaltung (GDPdU/GoBD, Version 1.6 von 2019,
 * CaseWare Germany). Mit ihr liest eine Prüfsoftware CSV-Dateien ohne Handarbeit ein (Datenträgerüberlassung, Z3,
 * § 147 Abs. 6 AO). Je CSV eine Table mit Pfad, Zeichensatz, Trennern, der übersprungenen Kopfzeile und den Spalten.
 *
 * Die DTD (gdpdu-01-03-2019.dtd) darf nicht verändert werden und liegt hier nicht bei; die Prüfsoftware oder die Prüfung
 * stellt sie. Welche Spalte Betrag oder Datum ist, weiß nur die App, die die CSV schreibt: Sie gibt den Typ je Spalte an.
 */

export const DTD_DATEI = "gdpdu-01-03-2019.dtd";

export type SpaltenTyp = { art: "text" } | { art: "zahl"; nachkommastellen: number } | { art: "datum" };

/** Die Überschriften einer CSV: erste Zeile, ohne BOM, getrennt mit Semikolon, Anführungszeichen nach RFC 4180 */
export function csvKopfzeile(bytes: Uint8Array): string[] {
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).replace(/^﻿/, "");
  const felder: string[] = [];
  let feld = "";
  let inAnfuehrung = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inAnfuehrung) {
      if (c === '"' && text[i + 1] === '"') {
        feld += '"';
        i++;
      } else if (c === '"') inAnfuehrung = false;
      else feld += c;
    } else if (c === '"') inAnfuehrung = true;
    else if (c === ";") {
      felder.push(feld);
      feld = "";
    } else if (c === "\r" || c === "\n") break;
    else feld += c;
  }
  felder.push(feld);
  return felder;
}

/** Ob die Bytes schon einen Zeilenumbruch außerhalb von Anführungszeichen enthalten */
function endeDerKopfzeile(bytes: Uint8Array): boolean {
  let inAnfuehrung = false;
  for (const b of bytes) {
    if (b === 0x22) inAnfuehrung = !inAnfuehrung;
    else if (b === 0x0a && !inAnfuehrung) return true;
  }
  return false;
}

/** Reicht einen CSV-Strom unverändert durch und meldet die Überschriften, sobald die erste Zeile vollständig gelesen ist */
export async function* mitKopfzeile(quelle: AsyncIterable<Uint8Array>, gefunden: (spalten: string[]) => void): AsyncGenerator<Uint8Array> {
  let kopf = new Uint8Array(0);
  let fertig = false;
  for await (const chunk of quelle) {
    if (!fertig) {
      const neu = new Uint8Array(kopf.length + chunk.length);
      neu.set(kopf);
      neu.set(chunk, kopf.length);
      kopf = neu;
      // Ende der ersten Zeile: ein Zeilenumbruch außerhalb von Anführungszeichen (RFC 4180)
      if (endeDerKopfzeile(kopf)) {
        gefunden(csvKopfzeile(kopf));
        fertig = true;
      }
    }
    yield chunk;
  }
  if (!fertig) gefunden(csvKopfzeile(kopf));
}

export interface BeschriebeneTabelle {
  /** Pfad der CSV im Archiv */
  path: string;
  name: string;
  beschreibung: string;
  spalten: { name: string; typ: SpaltenTyp }[];
}

export interface Beschreibung {
  /** Datenlieferant: Firma, Ort und ein Kommentar */
  lieferant: { name: string; ort: string; kommentar: string };
  /** Name des Datenträgers */
  medium: string;
  tabellen: BeschriebeneTabelle[];
}

/** Zeichen, die XML 1.0 nicht kennt: Steuerzeichen außer Tab, Zeilenumbruch und Wagenrücklauf, U+FFFE, U+FFFF und einzelne Surrogate */
// biome-ignore lint/suspicious/noControlCharactersInRegex: gerade die Steuerzeichen sollen weg
const UNGUELTIG = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const xmlText = (text: string) => text.replace(UNGUELTIG, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function spalte(name: string, typ: SpaltenTyp): string {
  const inhalt =
    typ.art === "zahl"
      ? `<Numeric><Accuracy>${typ.nachkommastellen}</Accuracy></Numeric>`
      : typ.art === "datum"
        ? "<Date><Format>YYYY-MM-DD</Format></Date>"
        : "<AlphaNumeric/>";
  return `\t\t\t\t\t<VariableColumn>\n\t\t\t\t\t\t<Name>${xmlText(name)}</Name>\n\t\t\t\t\t\t${inhalt}\n\t\t\t\t\t</VariableColumn>\n`;
}

function tabelle(t: BeschriebeneTabelle): string {
  return (
    "\t\t<Table>\n" +
    `\t\t\t<URL>${xmlText(t.path)}</URL>\n` +
    `\t\t\t<Name>${xmlText(t.name)}</Name>\n` +
    `\t\t\t<Description>${xmlText(t.beschreibung)}</Description>\n` +
    "\t\t\t<UTF8/>\n" +
    "\t\t\t<DecimalSymbol>,</DecimalSymbol>\n" +
    // Beträge stehen ohne Tausenderpunkt in der Datei; der Standard verlangt das Zeichen trotzdem neben dem Dezimalzeichen
    "\t\t\t<DigitGroupingSymbol>.</DigitGroupingSymbol>\n" +
    // Die erste Zeile jeder CSV ist die Kopfzeile
    "\t\t\t<Range>\n\t\t\t\t<From>2</From>\n\t\t\t</Range>\n" +
    "\t\t\t<VariableLength>\n" +
    "\t\t\t\t<ColumnDelimiter>;</ColumnDelimiter>\n" +
    "\t\t\t\t<RecordDelimiter>&#13;&#10;</RecordDelimiter>\n" +
    '\t\t\t\t<TextEncapsulator>"</TextEncapsulator>\n' +
    t.spalten.map((s) => spalte(s.name, s.typ)).join("") +
    "\t\t\t</VariableLength>\n" +
    "\t\t</Table>\n"
  );
}

/** Die index.xml: je CSV eine Table, nach Pfad sortiert, damit gleiche Daten gleiche Datei ergeben */
export function beschreibungXml(b: Beschreibung): string {
  const sortiert = [...b.tabellen].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<!DOCTYPE DataSet SYSTEM "${DTD_DATEI}">\n` +
    "<DataSet>\n" +
    "\t<Version>1.0</Version>\n" +
    "\t<DataSupplier>\n" +
    `\t\t<Name>${xmlText(b.lieferant.name)}</Name>\n` +
    `\t\t<Location>${xmlText(b.lieferant.ort)}</Location>\n` +
    `\t\t<Comment>${xmlText(b.lieferant.kommentar)}</Comment>\n` +
    "\t</DataSupplier>\n" +
    "\t<Media>\n" +
    `\t\t<Name>${xmlText(b.medium)}</Name>\n` +
    sortiert.map(tabelle).join("") +
    "\t</Media>\n" +
    "</DataSet>\n"
  );
}
