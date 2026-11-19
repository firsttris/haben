import { TAX_TREATMENTS, type Cents, type Millis } from "@haben/core";
import type { InvoiceDocument } from "./types.ts";

/* Beträge, Mengen, Steuerkategorien und Textbereinigung für das Rechnungsmodell (daten.ts) */

/** 123456 → "1234.56" */
export function amount(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 152000 → "152", 500 → "0.5" */
export function quantity(millis: Millis): string {
  const abs = Math.abs(millis);
  const fraction = String(abs % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${millis < 0 ? "-" : ""}${Math.floor(abs / 1000)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Netto-Einzelpreis bei Bruttopreisen: Zeilennetto ÷ Menge mit so vielen Nachkommastellen, dass
 * Menge × Preis wieder das Zeilennetto ergibt (PEPPOL-EN16931-R120). Ganzzahlig gerechnet, ohne Rundungsfehler.
 */
export function netUnitPrice(net: Cents, millis: Millis): string {
  const n = BigInt(Math.abs(net));
  const q = BigInt(Math.abs(millis));
  for (let decimals = 2; ; decimals++) {
    const scale = 10n ** BigInt(decimals + 1);
    // Preis in 10^-decimals Euro: net/100 ÷ millis/1000, kaufmännisch gerundet
    const price = (2n * n * scale + q) / (2n * q);
    if (decimals >= 10 || 2n * (q * price > n * scale ? q * price - n * scale : n * scale - q * price) <= scale) {
      const digits = price.toString().padStart(decimals + 1, "0");
      return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
    }
  }
}

export function percent(rate: number): string {
  return String(rate / 100);
}

export type TaxCategoryCode = "S" | "Z" | "E" | "AE" | "K" | "G" | "O";

/** Steuerkategorie (UNTDID 5305): Behandlung der Rechnung, sonst S bzw. Z für den Nullsatz */
export function taxCategory(doc: InvoiceDocument, rate: number): TaxCategoryCode {
  const treatment = doc.taxTreatment ?? "regulaer";
  if (treatment !== "regulaer") return TAX_TREATMENTS[treatment].category;
  return rate === 0 ? "Z" : "S";
}

/**
 * Kategorie und Satz. Bei „nicht steuerbar“ (O) darf in der Position kein Satz stehen (BR-O-05);
 * in der Steueraufschlüsselung verlangt XRechnung ihn trotzdem (BR-DE-14), dort steht 0.
 */
export function categoryWithRate(doc: InvoiceDocument, rate: number, place: "line" | "breakdown") {
  const id = taxCategory(doc, rate);
  const withRate = id !== "O" || place === "breakdown";
  return { "cbc:ID": id, ...(withRate ? { "cbc:Percent": percent(rate) } : {}), "cac:TaxScheme": { "cbc:ID": "VAT" } };
}

/** Entfernt in XML 1.0 unzulässige Zeichen aus allen Texten (etwa ein aus Word kopierter vertikaler Tab), sonst lehnt der Empfänger das XML ab; auch aus den Referenzen, die der CII-Post-Processor danach einsetzt */
export function withoutInvalidXmlChars<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind hier gesucht
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    ) as T;
  }
  if (Array.isArray(value)) return value.map(withoutInvalidXmlChars) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, withoutInvalidXmlChars(v)])) as T;
  }
  return value;
}
