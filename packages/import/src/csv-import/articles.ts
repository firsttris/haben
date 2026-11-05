import type { Cents, UnitLabel } from "@haben/core";
import { type ColumnMapping, type ImportField, rowReader } from "./mapping.ts";
import { duplicateKey, type RowCandidate } from "./plan.ts";
import type { CsvTable } from "./read.ts";
import { parseImportAmount, parseImportTaxRate, parseImportUnit } from "./values.ts";

/**
 * Artikel aus CSV, Spaltennamen wie in der Mustervorlage von Lexware Office für Produkte und Services (Artikelnummer,
 * Bezeichnung, Beschreibung, Einheit, Steuerart, Verkaufspreis, Notiz; Lexware-Hilfe „Produkte und Services per
 * CSV-Datei importieren“: https://help.lexware.de/de-form/articles/548269-produkte-und-services-per-csv-datei-importieren)
 * und den Feldern der Lexware-API (articleNumber, title …). Ein bloßes „Verkaufspreis“ ordnet Haben nicht selbst zu:
 * Ob er netto oder brutto ist, hängt in Lexware Office von den Allgemeinen Einstellungen ab.
 */
export const ARTICLE_FIELDS = [
  { key: "number", label: "Artikelnummer", aliases: ["Artikelnummer", "Artikelnr", "Art.-Nr.", "Produktnummer", "Nummer", "articleNumber", "SKU"] },
  {
    key: "description",
    label: "Bezeichnung",
    aliases: ["Bezeichnung", "Titel", "Artikelbezeichnung", "Artikelname", "Produktname", "Leistung", "Name", "title"],
  },
  { key: "detail", label: "Beschreibung", hint: "Text unter der Bezeichnung", aliases: ["Beschreibung", "Langtext", "Positionstext", "description"] },
  { key: "unit", label: "Einheit", hint: "Std., Tag, Monat, Stk., Psch. oder km; leer = Stk.", aliases: ["Einheit", "Mengeneinheit", "unitName"] },
  {
    key: "netPrice",
    label: "Nettopreis",
    hint: "Betrag wie 1.234,56",
    aliases: ["Nettopreis", "Preis netto", "Netto", "Verkaufspreis netto", "Einzelpreis netto", "Einzelpreis", "Preis", "netPrice"],
  },
  {
    key: "grossPrice",
    label: "Bruttopreis",
    hint: "Nur ohne Nettopreis: Artikel mit Endpreis",
    aliases: ["Bruttopreis", "Preis brutto", "Brutto", "Verkaufspreis brutto", "grossPrice"],
  },
  {
    key: "taxRate",
    label: "Steuersatz",
    hint: "19, 7 oder 0",
    aliases: [
      "Steuersatz",
      "Umsatzsteuer",
      "Umsatzsteuersatz",
      "USt",
      "USt-Satz",
      "MwSt",
      "MwSt-Satz",
      "Mehrwertsteuer",
      "Steuerart",
      "taxRate",
      "taxRatePercentage",
    ],
  },
  { key: "note", label: "Notiz", aliases: ["Notiz", "Bemerkung", "Interne Notiz", "note"] },
] as const satisfies readonly ImportField[];

export interface ArticleRow {
  number: string;
  description: string;
  detail: string;
  unit: UnitLabel;
  unitPrice: Cents;
  taxRate: 0 | 700 | 1900;
  priceIncludesTax: boolean;
  note: string;
}

/** Brutto aus Netto, kaufmännisch gerundet */
const grossOf = (net: Cents, rate: number) => Math.round((net * (10_000 + rate)) / 10_000);

/**
 * Preis: Nettopreis, sonst Bruttopreis (Artikel mit Endpreis). Stehen beide da wie im Export von Lexware Office, gilt
 * der Nettopreis, und der Bruttopreis muss auf den Cent dazu passen; sonst wäre unklar, welcher stimmt.
 */
function price(net: string, gross: string, rate: number | null): { unitPrice: Cents; priceIncludesTax: boolean } | string {
  const parsedNet = net ? parseImportAmount(net, "Nettopreis") : null;
  const parsedGross = gross ? parseImportAmount(gross, "Bruttopreis") : null;
  if (parsedNet && !parsedNet.ok) return parsedNet.error;
  if (parsedGross && !parsedGross.ok) return parsedGross.error;
  if (parsedNet?.ok) {
    if (parsedGross?.ok && rate !== null && Math.abs(grossOf(parsedNet.value, rate) - parsedGross.value) > 1) {
      return `Nettopreis ${net} und Bruttopreis ${gross} passen nicht zum Steuersatz`;
    }
    return { unitPrice: parsedNet.value, priceIncludesTax: false };
  }
  if (parsedGross?.ok) return { unitPrice: parsedGross.value, priceIncludesTax: true };
  return "Preis fehlt (Netto- oder Bruttopreis)";
}

export function articleCandidates(table: CsvTable, mapping: ColumnMapping): RowCandidate<ArticleRow>[] {
  return table.rows.map((row) => {
    const read = rowReader(row, mapping, ARTICLE_FIELDS, table.header.length);
    const { errors } = read;
    const number = read.text("number");
    const description = read.text("description");
    const detail = read.text("detail");
    const note = read.text("note");
    if (!description) errors.push("Bezeichnung fehlt");
    const unit = parseImportUnit(read.raw("unit"));
    if (!unit.ok) errors.push(unit.error);
    // Ohne Angabe kein stiller Standard: Kleinunternehmer brauchen 0 %, alle anderen meist 19 %
    const rawRate = read.raw("taxRate");
    const rate = rawRate ? parseImportTaxRate(rawRate) : null;
    if (!rate) errors.push("Steuersatz fehlt");
    else if (!rate.ok) errors.push(rate.error);
    const prices = price(read.raw("netPrice"), read.raw("grossPrice"), rate?.ok ? rate.value : null);
    if (typeof prices === "string") errors.push(prices);
    const value: ArticleRow | null =
      errors.length > 0 || !unit.ok || !rate?.ok || typeof prices === "string"
        ? null
        : { number, description, detail, unit: unit.value, taxRate: rate.value, ...prices, note };
    return {
      line: row.line,
      title: [number, description].filter(Boolean).join(" · ") || "(ohne Bezeichnung)",
      value,
      errors,
      keys: articleKeys({ number, description }),
    };
  });
}

/** Mit Artikelnummer ist sie das Merkmal; ohne Nummer die Bezeichnung (Groß- und Kleinschreibung egal) */
export function articleKeys(a: { number: string; description: string }) {
  return a.number.trim() ? duplicateKey("Artikelnummer", a.number) : duplicateKey("Bezeichnung", a.description);
}

/**
 * Merkmale eines Artikels im Bestand: Nummer und Bezeichnung. Eine Zeile ohne Nummer erkennt der Import so auch an
 * einem gleichnamigen Artikel mit Nummer; eine Zeile mit anderer Nummer bleibt ein eigener Artikel.
 */
export function articleStockKeys(a: { number: string; description: string }) {
  return [...duplicateKey("Artikelnummer", a.number), ...duplicateKey("Bezeichnung", a.description)];
}
