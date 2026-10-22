import { isCamt053, parseCamt053 } from "./camt.ts";
import { parseCsv } from "./csv.ts";
import { decodeText } from "./decode.ts";
import { isDkbAltHeader, isDkbHeader, parseDkb, parseDkbAlt } from "./dkb.ts";
import { StatementParseError } from "./errors.ts";
import { isN26Header, parseN26 } from "./n26.ts";
import { isPayPalHeader, isShopifyHeader, isStripeHeader, parsePayPal, parseShopify, parseStripe } from "./psp.ts";
import { findHeaderRow } from "./table.ts";
import type { ParsedStatement, StatementFormat } from "./types.ts";

type Detected =
  | { format: "camt053"; text: string }
  | { format: Exclude<StatementFormat, "camt053" | "enablebanking">; rows: string[][]; headerRow: number };

function detect(text: string, label: string): Detected {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    if (isCamt053(trimmed)) return { format: "camt053", text: trimmed };
    if (/BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn/.test(trimmed)) {
      throw new StatementParseError(
        `${label} ist ein CAMT.052- oder CAMT.054-Bericht. Unterstützt wird nur der Tagesauszug CAMT.053.`,
      );
    }
    throw new StatementParseError(`${label} ist eine XML-Datei, aber kein CAMT.053-Kontoauszug.`);
  }

  // Erkennung an den ersten 40 Zeilen (weiter sucht findHeaderRow nicht), dann einmal komplett parsen
  const head = text.split("\n", 40).join("\n");
  const semicolon = parseCsv(head, ";");
  const dkb = findHeaderRow(semicolon, isDkbHeader);
  if (dkb >= 0) return { format: "dkb-csv", rows: parseCsv(text, ";"), headerRow: dkb };
  const dkbAlt = findHeaderRow(semicolon, isDkbAltHeader);
  if (dkbAlt >= 0) return { format: "dkb-csv-alt", rows: parseCsv(text, ";"), headerRow: dkbAlt };

  const comma = parseCsv(head, ",");
  const n26 = findHeaderRow(comma, isN26Header);
  if (n26 >= 0) return { format: "n26-csv", rows: parseCsv(text, ","), headerRow: n26 };
  const paypal = findHeaderRow(comma, isPayPalHeader);
  if (paypal >= 0) return { format: "paypal-csv", rows: parseCsv(text, ","), headerRow: paypal };
  const stripe = findHeaderRow(comma, isStripeHeader);
  if (stripe >= 0) return { format: "stripe-csv", rows: parseCsv(text, ","), headerRow: stripe };
  const shopify = findHeaderRow(comma, isShopifyHeader);
  if (shopify >= 0) return { format: "shopify-payments-csv", rows: parseCsv(text, ","), headerRow: shopify };

  throw new StatementParseError(
    `${label} wurde nicht erkannt. Unterstützt werden CSV-Exporte von DKB und N26, CAMT.053 (XML) sowie die Exporte von PayPal, Stripe und Shopify Payments.`,
  );
}

/**
 * Liest einen Kontoauszug. Bank und Format werden am Inhalt erkannt, nicht am Dateinamen;
 * der Dateiname dient nur der Fehlermeldung.
 */
export function parseStatement(bytes: Uint8Array, filename?: string): ParsedStatement {
  const label = filename ? `„${filename}“` : "Die Datei";
  const text = decodeText(bytes).replace(/^\uFEFF/, "");
  if (text.trim() === "") throw new StatementParseError(`${label} ist leer.`);
  if (text.includes("\u0000")) throw new StatementParseError(`${label} ist keine Text- oder XML-Datei.`);

  const detected = detect(text, label);
  switch (detected.format) {
    case "camt053":
      return parseCamt053(detected.text);
    case "dkb-csv":
      return parseDkb(detected.rows, detected.headerRow);
    case "dkb-csv-alt":
      return parseDkbAlt(detected.rows, detected.headerRow);
    case "n26-csv":
      return parseN26(detected.rows, detected.headerRow);
    case "paypal-csv":
      return parsePayPal(detected.rows, detected.headerRow);
    case "stripe-csv":
      return parseStripe(detected.rows, detected.headerRow);
    case "shopify-payments-csv":
      return parseShopify(detected.rows, detected.headerRow);
  }
}

/** Nur das Format bestimmen, ohne die Umsätze zu lesen. */
export function detectStatementFormat(bytes: Uint8Array): StatementFormat | null {
  try {
    return detect(decodeText(bytes).replace(/^\uFEFF/, ""), "Die Datei").format;
  } catch {
    return null;
  }
}
