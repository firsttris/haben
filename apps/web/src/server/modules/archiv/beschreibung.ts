import type { ArchiveFile } from "./export.ts";

/*
 * index.xml für das Jahresarchiv (#546): die Beschreibungsdatei nach dem Beschreibungsstandard der Finanzverwaltung
 * (GDPdU/GoBD, Version 1.6 von 2019, CaseWare Germany). Mit ihr liest eine Prüfsoftware die CSV-Dateien des Archivs ohne
 * Handarbeit ein (Datenträgerüberlassung, Z3, § 147 Abs. 6 AO). Je CSV eine Table mit Pfad, Zeichensatz, Trennern, der
 * übersprungenen Kopfzeile und den Spalten. Die Annahme durch eine Prüfsoftware ist ungeprüft.
 *
 * Die DTD (gdpdu-01-03-2019.dtd) darf nicht verändert werden und liegt dem Archiv nicht bei: Haben hat keine
 * Originalfassung; die Prüfsoftware oder die Prüfung stellt sie, siehe docs/auswertungen.md.
 */

export const DTD_DATEI = "gdpdu-01-03-2019.dtd";

export type SpaltenTyp = { art: "text" } | { art: "zahl"; nachkommastellen: number } | { art: "datum" };

const TEXT: SpaltenTyp = { art: "text" };
const BETRAG: SpaltenTyp = { art: "zahl", nachkommastellen: 2 };
const DATUM: SpaltenTyp = { art: "datum" };

/**
 * Spalten, die das Archiv immer als Betrag („1234,56“) oder als Datum („JJJJ-MM-TT“) schreibt, je Datei. Alles andere ist
 * Text (AlphaNumeric): Das ist immer gültig und behält führende Nullen von Nummern; Zeitstempel („…T…Z“) sind keine Daten
 * im Sinne des Standards. Neue Spalten sind Text, bis sie hier stehen; ein Test prüft die Werte jeder Spalte, die hier
 * steht, gegen das erzeugte Archiv.
 */
const TYPEN: { pfad: RegExp; zahlen: string[]; daten: string[] }[] = [
  { pfad: /^rechnungen\/rechnungen\.csv$/, zahlen: ["Netto", "USt", "Brutto"], daten: ["Datum", "Fällig", "Leistung von", "Leistung bis"] },
  {
    pfad: /^belege\/belege\.csv$/,
    zahlen: ["Netto 19 %", "Vorsteuer 19 %", "Netto 7 %", "Vorsteuer 7 %", "Netto 0 %", "Netto", "Vorsteuer", "Brutto"],
    daten: ["Datum", "Fällig"],
  },
  { pfad: /^buchungen\/journal\.csv$/, zahlen: ["Soll", "Haben", "Bemessungsgrundlage"], daten: ["Datum"] },
  { pfad: /^bank\/[^/]+\/umsaetze\.csv$/, zahlen: ["Betrag", "Zugeordnet", "Offen"], daten: ["Buchungsdatum", "Wertstellung"] },
  { pfad: /^bank\/zuordnungen\.csv$/, zahlen: ["Betrag"], daten: ["Buchungsdatum"] },
];

/** Die Spalten je Datei mit bekanntem Betrags- oder Datumsformat; für den Test, der die Werte dagegen prüft */
export const TYPISIERTE_SPALTEN = TYPEN;

export function spaltenTyp(path: string, spalte: string): SpaltenTyp {
  for (const t of TYPEN) {
    if (!t.pfad.test(path)) continue;
    if (t.zahlen.includes(spalte)) return BETRAG;
    if (t.daten.includes(spalte)) return DATUM;
  }
  return TEXT;
}

/** Die Überschriften einer CSV des Archivs: erste Zeile, ohne BOM, mit Anführungszeichen nach RFC 4180 */
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
async function* mitKopfzeile(quelle: AsyncIterable<Uint8Array>, gefunden: (spalten: string[]) => void): AsyncGenerator<Uint8Array> {
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

export interface Tabelle {
  path: string;
  spalten: string[];
}

export interface IndexInfo {
  /** Firma und Ort des Datenlieferanten */
  name: string;
  ort: string;
  jahr: number;
  version: string;
}

/** Zeichen, die XML 1.0 nicht kennt: Steuerzeichen außer Tab, Zeilenumbruch und Wagenrücklauf, U+FFFE, U+FFFF und einzelne Surrogate */
// biome-ignore lint/suspicious/noControlCharactersInRegex: gerade die Steuerzeichen sollen weg
const UNGUELTIG = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const xmlText = (text: string) => text.replace(UNGUELTIG, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function spalte(path: string, name: string): string {
  const typ = spaltenTyp(path, name);
  const inhalt =
    typ.art === "zahl"
      ? `<Numeric><Accuracy>${typ.nachkommastellen}</Accuracy></Numeric>`
      : typ.art === "datum"
        ? "<Date><Format>YYYY-MM-DD</Format></Date>"
        : "<AlphaNumeric/>";
  return `\t\t\t\t\t<VariableColumn>\n\t\t\t\t\t\t<Name>${xmlText(name)}</Name>\n\t\t\t\t\t\t${inhalt}\n\t\t\t\t\t</VariableColumn>\n`;
}

function tabelle(t: Tabelle, jahr: number): string {
  const name = t.path.replace(/\.csv$/, "");
  return (
    "\t\t<Table>\n" +
    `\t\t\t<URL>${xmlText(t.path)}</URL>\n` +
    `\t\t\t<Name>${xmlText(name)}</Name>\n` +
    `\t\t\t<Description>${xmlText(`Jahresarchiv ${jahr}: ${t.path}`)}</Description>\n` +
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
    t.spalten.map((s) => spalte(t.path, s)).join("") +
    "\t\t\t</VariableLength>\n" +
    "\t\t</Table>\n"
  );
}

/** Die index.xml: je CSV eine Table, nach Pfad sortiert, damit gleiche Daten gleiche Datei ergeben */
export function indexXml(info: IndexInfo & { tabellen: Tabelle[] }): string {
  const sortiert = [...info.tabellen].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<!DOCTYPE DataSet SYSTEM "${DTD_DATEI}">\n` +
    "<DataSet>\n" +
    "\t<Version>1.0</Version>\n" +
    "\t<DataSupplier>\n" +
    `\t\t<Name>${xmlText(info.name)}</Name>\n` +
    `\t\t<Location>${xmlText(info.ort)}</Location>\n` +
    `\t\t<Comment>${xmlText(
      `Jahresarchiv ${info.jahr} aus Haben ${info.version}, Beschreibung nach dem Beschreibungsstandard der Finanzverwaltung (GDPdU, Version 1.6). Die Annahme durch eine Prüfsoftware ist ungeprüft.`,
    )}</Comment>\n` +
    "\t</DataSupplier>\n" +
    "\t<Media>\n" +
    `\t\t<Name>${xmlText(`Jahresarchiv ${info.jahr}`)}</Name>\n` +
    sortiert.map((t) => tabelle(t, info.jahr)).join("") +
    "\t</Media>\n" +
    "</DataSet>\n"
  );
}

/**
 * Dateien im Archiv, die Haben nicht selbst als CSV erzeugt, auch wenn ihr Name auf .csv endet: unveränderte Originale (der
 * DATEV-Stapel und andere Exporte des Altbestands, Auftragsdokumente aus sevDesk, Belege, die jemand hochgeladen hat). Sie
 * haben ein fremdes Format, die index.xml beschreibt sie nicht. Anhänge unter anhaenge/ sind immer PDF; die anhaenge.csv
 * dort schreibt Haben selbst.
 */
const ORIGINALE = [/^lexoffice\/(originale|belege)\//, /^sevdesk\/auftraege\//, /^belege\/(?!belege\.csv$|verrechnungen\.csv$)/];

const istEigeneCsv = (path: string) => path.endsWith(".csv") && !ORIGINALE.some((muster) => muster.test(path));

/** Reicht die Dateien des Archivs unverändert durch und hängt die index.xml aller CSVs hinten an (vor den Prüfsummen) */
export async function* mitIndexXml(files: AsyncIterable<ArchiveFile>, info: IndexInfo): AsyncGenerator<ArchiveFile> {
  const tabellen: Tabelle[] = [];
  for await (const file of files) {
    if (!istEigeneCsv(file.path)) {
      yield file;
    } else if (file.content instanceof Uint8Array) {
      tabellen.push({ path: file.path, spalten: csvKopfzeile(file.content) });
      yield file;
    } else {
      // Als Strom (etwa das Änderungsprotokoll): Die Kopfzeile steht fest, sobald das ZIP den Strom bis hinter den ersten
      // Zeilenumbruch gelesen hat, also lange vor dem Ende der Datei und vor der index.xml
      const tabelle: Tabelle = { path: file.path, spalten: [] };
      tabellen.push(tabelle);
      yield { ...file, content: mitKopfzeile(file.content, (spalten) => (tabelle.spalten = spalten)) };
    }
  }
  yield { path: "index.xml", content: new TextEncoder().encode(indexXml({ ...info, tabellen })), compress: true };
}
