import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

/**
 * Minimaler Leser für die Tabellen im Accountable-Export.
 *
 * Gebraucht wird nur `Daten.xlsx` mit dem Sheet „Ausgaben“: dort stehen Kategorie, Lieferant und
 * Zahlungsdatum, die im DATEV-Stapel fehlen. Ein vollständiger xlsx-Leser (Formeln, Formate,
 * verbundene Zellen) wäre dafür zu viel. Gelesen werden Zellwerte, geteilte Zeichenketten
 * (`sharedStrings.xml`) und eingebettete Zeichenketten (`inlineStr`); die echte Datei schreibt Text
 * als `t="str"` und Zahlen als Zahl. Alles kommt als Text heraus, damit „0490“ seine führende Null
 * behält — Zahlen wandelt erst der Aufrufer, der ihre Bedeutung kennt.
 */

/** Eine Zeile als Objekt: Spaltenkopf der ersten Zeile → Wert der Zelle (leer, wenn nichts dasteht) */
export type XlsxRow = Record<string, string>;

/** Ein XML-Knoten, wie ihn fast-xml-parser liefert */
type XmlNode = Record<string, unknown>;

const decoder = new TextDecoder("utf-8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // `r:id` heißt nach dem Entfernen des Präfixes `id`
  removeNSPrefix: true,
  // Werte bleiben Text: sonst würde aus „0490“ die Zahl 490 und aus 45.49 ein Float
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "sheet" || name === "row" || name === "c" || name === "si" || name === "Relationship",
});

/**
 * Liest ein Sheet als Liste von Zeilen, Schlüssel sind die Spaltenköpfe der ersten Zeile.
 * Gesucht wird das Sheet über seinen Namen in `xl/workbook.xml`. Fehlt es, ist das Ergebnis leer:
 * der Import läuft dann ohne die Zusatzangaben weiter, statt den Export abzulehnen.
 */
export function readXlsxSheet(bytes: Uint8Array, sheetName: string): XlsxRow[] {
  const files = unzipSync(bytes);
  const path = sheetPathOf(files, sheetName);
  const sheetFile = path ? files[path] : undefined;
  if (!sheetFile) return [];
  const shared = sharedStrings(files["xl/sharedStrings.xml"]);
  const rows = children(first(sheetFile, "worksheet", "sheetData"), "row");

  const table: XlsxRow[] = [];
  let header: (string | null)[] | null = null;
  for (const row of rows) {
    const cells = cellsOf(row, shared);
    // Die erste Zeile mit Inhalt ist die Kopfzeile; sie benennt die Spalten
    if (!header) {
      if (cells.some((cell) => cell !== null && cell !== "")) header = cells;
      continue;
    }
    const entry: XlsxRow = {};
    let filled = false;
    header.forEach((name, index) => {
      if (!name) return;
      const value = cells[index] ?? "";
      entry[name] = value;
      if (value !== "") filled = true;
    });
    if (filled) table.push(entry);
  }
  return table;
}

/** Zellen einer Zeile, einsortiert nach Spalte; Lücken im XML bleiben leer */
function cellsOf(row: XmlNode, shared: string[]): (string | null)[] {
  const cells: (string | null)[] = [];
  for (const cell of children(row, "c")) {
    const index = columnIndex(String(cell.r ?? ""));
    if (index === 0) continue;
    while (cells.length < index) cells.push(null);
    cells[index - 1] = cellValue(cell, shared);
  }
  return cells;
}

function cellValue(cell: XmlNode, shared: string[]): string {
  const type = typeof cell.t === "string" ? cell.t : "";
  // inlineStr trägt den Text in <is><t>, teils in mehrere <r>-Läufe zerlegt
  if (type === "inlineStr") return textOf(cell.is).trim();
  const raw = cell.v === undefined || cell.v === null ? "" : String(cell.v);
  // t="s" ist ein Verweis auf sharedStrings.xml
  if (type === "s") return (shared[Number(raw)] ?? "").trim();
  // t="b" ist ein Wahrheitswert, 1 oder 0
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw.trim();
}

/** Alle Textknoten unter einem Knoten; `<t>` und die Läufe `<r>` zählen, Formate nicht */
function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return Object.entries(node as XmlNode)
    .filter(([key]) => key === "t" || key === "r")
    .map(([, value]) => textOf(value))
    .join("");
}

function sharedStrings(file: Uint8Array | undefined): string[] {
  if (!file) return [];
  return children(first(file, "sst"), "si").map((entry) => textOf(entry).trim());
}

/** Pfad des Sheets im ZIP; gesucht über `xl/workbook.xml` und dessen Beziehungen */
function sheetPathOf(files: Record<string, Uint8Array>, name: string): string | null {
  const sheet = children(first(files["xl/workbook.xml"], "workbook", "sheets"), "sheet").find((entry) => entry.name === name);
  if (!sheet) return null;
  // `r:id="rId1"` heißt nach removeNSPrefix `id`
  const id = typeof sheet.id === "string" ? sheet.id : "";
  const relation = children(first(files["xl/_rels/workbook.xml.rels"], "Relationships"), "Relationship").find((entry) => entry.Id === id);
  const target = typeof relation?.Target === "string" ? relation.Target : "";
  if (!target) return null;
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  return path.replace(/\/\.\//g, "/");
}

/** Spaltenbuchstaben aus einer Zelladresse: `AB12` → 28, ohne Buchstaben → 0 */
function columnIndex(ref: string): number {
  const letters = /^([A-Za-z]+)/.exec(ref)?.[1]?.toUpperCase() ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index;
}

/** Knoten entlang eines Pfades; das Ergebnis ist immer eine Liste */
function first(file: Uint8Array | undefined, ...path: string[]): XmlNode | null {
  if (!file) return null;
  let current: XmlNode | null = parser.parse(decoder.decode(file)) as XmlNode;
  for (const key of path) {
    current = children(current, key)[0] ?? null;
    if (!current) return null;
  }
  return current;
}

/** Kindknoten unter einem Schlüssel, als Liste; Text- und Zahlenknoten fallen heraus */
function children(node: unknown, key: string): XmlNode[] {
  if (typeof node !== "object" || node === null) return [];
  const value = (node as XmlNode)[key];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((entry): entry is XmlNode => typeof entry === "object" && entry !== null);
}
