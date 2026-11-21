import { isC24Header, parseC24 } from "./c24.ts";
import { isCamt053, parseCamt053 } from "./camt.ts";
import { parseCsv } from "./csv.ts";
import { decodeText } from "./decode.ts";
import { isCommerzbankHeader, parseCommerzbank } from "./commerzbank.ts";
import { isDeutscheBankGroupAltHeader, isDeutscheBankGroupHeader, parseDeutscheBankGroup } from "./deutsche-bank-group.ts";
import { isDkbAltHeader, isDkbHeader, parseDkb, parseDkbAlt } from "./dkb.ts";
import { isEbayHeader, parseEbay } from "./ebay.ts";
import { StatementParseError } from "./errors.ts";
import { isEtsyHeader, parseEtsy } from "./etsy.ts";
import { isIngHeader, parseIng } from "./ing.ts";
import { isBwBankHeader, parseBwBank } from "./bw-bank.ts";
import { isN26Header, parseN26 } from "./n26.ts";
import { isSwanHeader, parseSwan } from "./swan.ts";
import { isPayPalHeader, isShopifyHeader, isStripeHeader, parsePayPal, parseShopify, parseStripe } from "./psp.ts";
import { findHeaderRow } from "./table.ts";
import type { ParsedStatement, StatementFormat } from "./types.ts";

type Detected =
  | { format: "camt053"; text: string }
  | {
      // accountable-xlsx steht nicht in der Liste: diese Umsaetze kommen mit dem Export, nie als Datei
      format: Exclude<
        StatementFormat,
        | "camt053"
        | "enablebanking"
        | "fints"
        | "googleplay-earnings"
        | "appstore-finance"
        | "store-payout"
        | "accountable-xlsx"
        | "csv-zuordnung"
        // Lieferungen über den REST-Import (importvertrag/auszug.ts), nie als Datei
        | "importvertrag"
        | "importvertrag-psp"
      >;
      rows: string[][];
      headerRow: number;
    };

function detect(text: string, label: string): Detected {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    if (isCamt053(trimmed)) return { format: "camt053", text: trimmed };
    if (/BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn/.test(trimmed)) {
      throw new StatementParseError(`${label} ist ein CAMT.052- oder CAMT.054-Bericht. Unterstützt wird nur der Tagesauszug CAMT.053.`);
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
  const commerzbank = findHeaderRow(semicolon, isCommerzbankHeader);
  if (commerzbank >= 0) return { format: "commerzbank-csv", rows: parseCsv(text, ";"), headerRow: commerzbank };
  const bwBank = findHeaderRow(semicolon, isBwBankHeader);
  if (bwBank >= 0) return { format: "bw-bank-csv", rows: parseCsv(text, ";"), headerRow: bwBank };
  const ing = findHeaderRow(semicolon, isIngHeader);
  if (ing >= 0) return { format: "ing-csv", rows: parseCsv(text, ";"), headerRow: ing };
  const deutscheBank = findHeaderRow(semicolon, isDeutscheBankGroupHeader);
  if (deutscheBank >= 0) return { format: "deutsche-bank-group-csv", rows: parseCsv(text, ";"), headerRow: deutscheBank };
  const deutscheBankAlt = findHeaderRow(semicolon, isDeutscheBankGroupAltHeader);
  if (deutscheBankAlt >= 0) return { format: "deutsche-bank-group-csv", rows: parseCsv(text, ";"), headerRow: deutscheBankAlt };
  const ebaySemicolon = findHeaderRow(semicolon, isEbayHeader);
  if (ebaySemicolon >= 0) return { format: "ebay-csv", rows: parseCsv(text, ";"), headerRow: ebaySemicolon };

  const comma = parseCsv(head, ",");
  const c24 = findHeaderRow(comma, isC24Header);
  if (c24 >= 0) return { format: "c24-csv", rows: parseCsv(text, ","), headerRow: c24 };
  // Swan vor N26: dessen Kopfblock traegt Datum/Name/Verwendungszweck, die N26-Erkennung
  // wuerde an einer solchen Datei nicht greifen, aber die Reihenfolge soll eindeutig sein.
  const swan = findHeaderRow(comma, isSwanHeader);
  if (swan >= 0) return { format: "swan-csv", rows: parseCsv(text, ","), headerRow: swan };
  const n26 = findHeaderRow(comma, isN26Header);
  if (n26 >= 0) return { format: "n26-csv", rows: parseCsv(text, ","), headerRow: n26 };
  // Vor PayPal: dessen englische Kopfzeile (gross, fee, net, transactionid) passt dem Präfix nach auch auf eBay
  const ebay = findHeaderRow(comma, isEbayHeader);
  if (ebay >= 0) return { format: "ebay-csv", rows: parseCsv(text, ","), headerRow: ebay };
  const paypal = findHeaderRow(comma, isPayPalHeader);
  if (paypal >= 0) return { format: "paypal-csv", rows: parseCsv(text, ","), headerRow: paypal };
  const stripe = findHeaderRow(comma, isStripeHeader);
  if (stripe >= 0) return { format: "stripe-csv", rows: parseCsv(text, ","), headerRow: stripe };
  const shopify = findHeaderRow(comma, isShopifyHeader);
  if (shopify >= 0) return { format: "shopify-payments-csv", rows: parseCsv(text, ","), headerRow: shopify };
  const etsy = findHeaderRow(comma, isEtsyHeader);
  if (etsy >= 0) return { format: "etsy-csv", rows: parseCsv(text, ","), headerRow: etsy };

  throw new StatementParseError(
    `${label} wurde nicht erkannt. Unterstützt werden CSV-Exporte von DKB, Commerzbank, BW-Bank, Deutscher Bank, Norisbank, Postbank, ING, C24, N26 und Swan, CAMT.053 (XML) sowie die Exporte von PayPal, Stripe, Shopify Payments, der Transaktionsbericht von eBay und die Monatsabrechnung von Etsy.`,
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
    case "swan-csv":
      return parseSwan(detected.rows, detected.headerRow);
    case "commerzbank-csv":
      return parseCommerzbank(detected.rows, detected.headerRow);
    case "bw-bank-csv":
      return parseBwBank(detected.rows, detected.headerRow);
    case "ing-csv":
      return parseIng(detected.rows, detected.headerRow);
    case "c24-csv":
      return parseC24(detected.rows, detected.headerRow);
    case "deutsche-bank-group-csv":
      return parseDeutscheBankGroup(detected.rows, detected.headerRow);
    case "paypal-csv":
      return parsePayPal(detected.rows, detected.headerRow);
    case "stripe-csv":
      return parseStripe(detected.rows, detected.headerRow);
    case "shopify-payments-csv":
      return parseShopify(detected.rows, detected.headerRow);
    case "ebay-csv":
      return parseEbay(detected.rows, detected.headerRow);
    case "etsy-csv":
      return parseEtsy(detected.rows, detected.headerRow);
    // Der Abruf der Transaction Search von PayPal kommt über die API (paypal/statement.ts), nicht als Datei
    case "paypal-api":
      throw new StatementParseError("Der Abruf von PayPal kommt über die API, nicht als Datei.");
    // Der Zahlungsverlauf von Etsy Payments kommt über die API (etsy-ledger.ts), nicht als Datei
    case "etsy-ledger":
      throw new StatementParseError("Der Etsy-Zahlungsverlauf kommt über die API, nicht als Datei.");
    // Der Abruf der Balance Transactions von Stripe kommt über die API (stripe/statement.ts), nicht als Datei
    case "stripe-api":
      throw new StatementParseError("Der Abruf von Stripe kommt über die API, nicht als Datei.");
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
