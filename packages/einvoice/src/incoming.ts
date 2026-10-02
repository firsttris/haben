import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { BasisPoints, Cents, Millis } from "@haben/core";
import { decodeXmlBytes, extractEmbeddedXml } from "./embedded.ts";

/** Eingangsrechnung, aus CII oder UBL gelesen */
export interface IncomingInvoice {
  syntax: "cii" | "ubl";
  /** UNTDID 1001: 380 Rechnung, 381 Gutschrift, 384 Korrektur, ... */
  typeCode: string;
  isCreditNote: boolean;
  number: string;
  /** ISO-Datum YYYY-MM-DD */
  issueDate: string;
  dueDate?: string;
  currency: string;
  seller: IncomingSeller;
  buyerReference?: string;
  serviceFrom?: string;
  serviceTo?: string;
  /** Je Steuersatz; Vorzeichen: Gutschriften negativ */
  taxes: IncomingTax[];
  net: Cents;
  tax: Cents;
  /** Gesamtbetrag brutto (BT-112) */
  gross: Cents;
  /** Zahlbetrag (BT-115), nach Anzahlungen und Rundung */
  duePayable: Cents;
  lines: IncomingLine[];
  paymentReference?: string;
  iban?: string;
}

export interface IncomingSeller {
  name: string;
  ustId?: string;
  steuernummer?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
  land?: string;
  email?: string;
  iban?: string;
}

export interface IncomingTax {
  rate: BasisPoints;
  /** UNCL 5305: S, Z, E, AE, K, G, O, L, M */
  category: string;
  base: Cents;
  tax: Cents;
}

export interface IncomingLine {
  description: string;
  quantity: Millis;
  unitCode?: string;
  net: Cents;
  taxRate: BasisPoints;
}

export class EInvoiceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EInvoiceParseError";
  }
}

// Gutschriftarten nach UNTDID 1001, die EN 16931 zulässt
const CREDIT_NOTE_CODES = new Set(["81", "83", "261", "262", "296", "308", "381", "396", "420", "458", "532"]);

// ---------- Zugriff auf den geparsten Baum (Namensraumpräfixe sind entfernt) ----------

type Node = Record<string, unknown>;

function all(node: unknown, ...path: string[]): unknown[] {
  let current: unknown[] = [node];
  for (const key of path) {
    current = current.flatMap((n) => {
      if (!n || typeof n !== "object" || Array.isArray(n)) return [];
      const value = (n as Node)[key];
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    });
  }
  return current;
}

function one(node: unknown, ...path: string[]): unknown {
  return all(node, ...path)[0];
}

/** Erster Pfad, der etwas liefert (ZUGFeRD 1.0 benennt Elemente anders) */
function first(node: unknown, ...paths: string[][]): unknown {
  for (const path of paths) {
    const found = one(node, ...path);
    if (found !== undefined) return found;
  }
  return undefined;
}

function text(node: unknown): string | undefined {
  const value = node && typeof node === "object" ? (node as Node)["#text"] : node;
  if (value === undefined || value === null || typeof value === "object") return undefined;
  const trimmed = String(value).trim();
  return trimmed === "" ? undefined : trimmed;
}

function attr(node: unknown, name: string): string | undefined {
  return node && typeof node === "object" ? text((node as Node)[`@_${name}`]) : undefined;
}

function textAt(node: unknown, ...path: string[]): string | undefined {
  for (const found of all(node, ...path)) {
    const value = text(found);
    if (value !== undefined) return value;
  }
  return undefined;
}

// ---------- Zahlen und Daten ----------

/**
 * Dezimalzeichenkette → ganze Zahl in 10^-scale, ohne Gleitkomma.
 * exact: weitere Nachkommastellen ungleich 0 sind ein Fehler, sonst wird kaufmännisch gerundet.
 */
export function parseDecimal(value: string, scale: number, exact: boolean): number {
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (!match[2] && !match[3])) throw new EInvoiceParseError(`Ungültiger Betrag „${value}“`);
  const sign = match[1] === "-" ? -1 : 1;
  const fraction = match[3] ?? "";
  const kept = fraction.slice(0, scale).padEnd(scale, "0");
  const rest = fraction.slice(scale);
  if (exact && /[1-9]/.test(rest)) {
    throw new EInvoiceParseError(`Betrag „${value}“ hat mehr als ${scale} Nachkommastellen`);
  }
  let result = Number(`${match[2] || "0"}${kept}`);
  if (rest !== "" && rest[0]! >= "5") result += 1;
  if (!Number.isSafeInteger(result)) throw new EInvoiceParseError(`Betrag „${value}“ ist zu groß`);
  return sign * result || 0;
}

const cents = (value: string): Cents => parseDecimal(value, 2, true);
const roundedCents = (value: string): Cents => parseDecimal(value, 2, false);
const basisPoints = (value: string | undefined): BasisPoints => (value === undefined ? 0 : parseDecimal(value, 2, false));
const millis = (value: string | undefined): Millis => (value === undefined ? 0 : parseDecimal(value, 3, false));

/** CII-Format 102 (YYYYMMDD) oder ISO-Datum → YYYY-MM-DD */
function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return undefined;
  return `${year}-${month}-${day}`;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new EInvoiceParseError(`${what} fehlt in der E-Rechnung`);
  return value;
}

/** Betrag in Belegwährung, falls ein Element je Währung mehrfach vorkommt */
function amountIn(nodes: unknown[], currency: string): string | undefined {
  const match = nodes.find((n) => attr(n, "currencyID") === currency) ?? nodes.find((n) => !attr(n, "currencyID")) ?? nodes[0];
  return text(match);
}

const compact = (value: string | undefined) => value?.replace(/\s+/g, "").toUpperCase();

// ---------- Parser ----------

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  trimValues: true,
  // dekodiert auch numerische Zeichenreferenzen (&#252;)
  htmlEntities: true,
});

/** Liest eine E-Rechnung im Format CII (ZUGFeRD 1/2, Factur-X, XRechnung) oder UBL (Invoice, CreditNote). */
export function parseEInvoiceXml(xml: string): IncomingInvoice {
  const source = xml.replace(/^\uFEFF/, "");
  const valid = XMLValidator.validate(source);
  if (valid !== true) {
    throw new EInvoiceParseError(`Kein gültiges XML (Zeile ${valid.err.line}): ${valid.err.msg}`);
  }
  let tree: Node;
  try {
    tree = parser.parse(source) as Node;
  } catch (error) {
    throw new EInvoiceParseError(`XML konnte nicht gelesen werden: ${(error as Error).message}`);
  }
  const rootName = Object.keys(tree).find((key) => !key.startsWith("?") && !key.startsWith("#"));
  const root = rootName ? tree[rootName] : undefined;
  switch (rootName) {
    case "CrossIndustryInvoice":
    case "CrossIndustryDocument":
      return finish(parseCii(root));
    case "Invoice":
    case "CreditNote":
      return finish(parseUbl(root, rootName === "CreditNote"));
    default:
      throw new EInvoiceParseError(
        rootName ? `Unbekanntes XML-Format <${rootName}>: keine E-Rechnung (CII oder UBL)` : "Leeres XML-Dokument",
      );
  }
}

/** Gutschriften negativ, fehlende Steuersumme ergänzen */
function finish(invoice: IncomingInvoice): IncomingInvoice {
  if (!invoice.isCreditNote) return invoice;
  const neg = (value: number) => -value || 0;
  return {
    ...invoice,
    taxes: invoice.taxes.map((t) => ({ ...t, base: neg(t.base), tax: neg(t.tax) })),
    net: neg(invoice.net),
    tax: neg(invoice.tax),
    gross: neg(invoice.gross),
    duePayable: neg(invoice.duePayable),
    lines: invoice.lines.map((line) => ({ ...line, net: neg(line.net) })),
  };
}

function parseCii(root: unknown): IncomingInvoice {
  const header = first(root, ["ExchangedDocument"], ["HeaderExchangedDocument"]);
  const transaction = first(root, ["SupplyChainTradeTransaction"], ["SpecifiedSupplyChainTradeTransaction"]);
  if (!header || !transaction) throw new EInvoiceParseError("CII-Dokument ohne Kopf oder Handelsdaten");
  const agreement = first(transaction, ["ApplicableHeaderTradeAgreement"], ["ApplicableSupplyChainTradeAgreement"]);
  const delivery = first(transaction, ["ApplicableHeaderTradeDelivery"], ["ApplicableSupplyChainTradeDelivery"]);
  const settlement = first(transaction, ["ApplicableHeaderTradeSettlement"], ["ApplicableSupplyChainTradeSettlement"]);
  const sums = first(settlement, ["SpecifiedTradeSettlementHeaderMonetarySummation"], ["SpecifiedTradeSettlementMonetarySummation"]);

  const typeCode = textAt(header, "TypeCode") ?? "380";
  const currency = required(textAt(settlement, "InvoiceCurrencyCode"), "Währung");

  const sellerNode = one(agreement, "SellerTradeParty");
  const registrations = all(sellerNode, "SpecifiedTaxRegistration", "ID");
  const registration = (scheme: string) => text(registrations.find((r) => attr(r, "schemeID") === scheme));
  const address = one(sellerNode, "PostalTradeAddress");
  const iban = compact(textAt(settlement, "SpecifiedTradeSettlementPaymentMeans", "PayeePartyCreditorFinancialAccount", "IBANID"));
  const electronic = one(sellerNode, "URIUniversalCommunication", "URIID");
  const seller: IncomingSeller = {
    name: required(textAt(sellerNode, "Name"), "Name des Verkäufers"),
    ustId: registration("VA"),
    steuernummer: registration("FC"),
    strasse: textAt(address, "LineOne"),
    plz: textAt(address, "PostcodeCode"),
    ort: textAt(address, "CityName"),
    land: textAt(address, "CountryID"),
    email:
      textAt(sellerNode, "DefinedTradeContact", "EmailURIUniversalCommunication", "URIID") ??
      (attr(electronic, "schemeID") === "EM" ? text(electronic) : undefined),
    iban,
  };

  const taxes = all(settlement, "ApplicableTradeTax")
    .filter((t) => (textAt(t, "TypeCode") ?? "VAT") === "VAT")
    .map((t) => ({
      rate: basisPoints(textAt(t, "RateApplicablePercent") ?? textAt(t, "ApplicablePercent")),
      category: textAt(t, "CategoryCode") ?? "S",
      base: cents(required(textAt(t, "BasisAmount"), "Steuerbasis")),
      tax: cents(required(textAt(t, "CalculatedAmount"), "Steuerbetrag")),
    }));

  const lines = all(transaction, "IncludedSupplyChainTradeLineItem").map((item) => {
    const lineSettlement = first(item, ["SpecifiedLineTradeSettlement"], ["SpecifiedSupplyChainTradeSettlement"]);
    const quantity = one(first(item, ["SpecifiedLineTradeDelivery"], ["SpecifiedSupplyChainTradeDelivery"]), "BilledQuantity");
    const lineTax = one(lineSettlement, "ApplicableTradeTax");
    return {
      description: textAt(item, "SpecifiedTradeProduct", "Name") ?? textAt(item, "SpecifiedTradeProduct", "Description") ?? "",
      quantity: millis(text(quantity)),
      unitCode: attr(quantity, "unitCode"),
      net: roundedCents(
        textAt(lineSettlement, "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount") ??
          textAt(lineSettlement, "SpecifiedTradeSettlementMonetarySummation", "LineTotalAmount") ??
          "0",
      ),
      taxRate: basisPoints(textAt(lineTax, "RateApplicablePercent") ?? textAt(lineTax, "ApplicablePercent")),
    };
  });

  const net = cents(required(textAt(sums, "TaxBasisTotalAmount"), "Nettosumme"));
  const taxText = amountIn(all(sums, "TaxTotalAmount"), currency);
  const gross = cents(required(textAt(sums, "GrandTotalAmount"), "Gesamtbetrag"));
  const dueText = textAt(sums, "DuePayableAmount");
  const deliveryDate = isoDate(textAt(delivery, "ActualDeliverySupplyChainEvent", "OccurrenceDateTime", "DateTimeString"));
  const period = one(settlement, "BillingSpecifiedPeriod");

  return {
    syntax: "cii",
    typeCode,
    isCreditNote: CREDIT_NOTE_CODES.has(typeCode),
    number: required(textAt(header, "ID"), "Rechnungsnummer"),
    issueDate: required(isoDate(textAt(header, "IssueDateTime", "DateTimeString")), "Rechnungsdatum"),
    dueDate: isoDate(textAt(settlement, "SpecifiedTradePaymentTerms", "DueDateDateTime", "DateTimeString")),
    currency,
    seller,
    buyerReference: textAt(agreement, "BuyerReference"),
    serviceFrom: isoDate(textAt(period, "StartDateTime", "DateTimeString")) ?? deliveryDate,
    serviceTo: isoDate(textAt(period, "EndDateTime", "DateTimeString")) ?? deliveryDate,
    taxes,
    net,
    tax: taxText !== undefined ? cents(taxText) : taxes.reduce((sum, t) => sum + t.tax, 0),
    gross,
    duePayable: dueText !== undefined ? cents(dueText) : gross,
    lines,
    paymentReference: textAt(settlement, "PaymentReference"),
    iban,
  };
}

function parseUbl(root: unknown, creditNote: boolean): IncomingInvoice {
  const typeCode = textAt(root, creditNote ? "CreditNoteTypeCode" : "InvoiceTypeCode") ?? (creditNote ? "381" : "380");
  const currency = required(textAt(root, "DocumentCurrencyCode"), "Währung");

  const party = one(root, "AccountingSupplierParty", "Party");
  const taxSchemes = all(party, "PartyTaxScheme");
  const vat = taxSchemes.find((s) => textAt(s, "TaxScheme", "ID") === "VAT");
  const other = taxSchemes.find((s) => s !== vat);
  const address = one(party, "PostalAddress");
  const endpoint = one(party, "EndpointID");
  const paymentMeans = all(root, "PaymentMeans");
  const iban = compact(paymentMeans.map((m) => textAt(m, "PayeeFinancialAccount", "ID")).find(Boolean));
  const seller: IncomingSeller = {
    name: required(textAt(party, "PartyLegalEntity", "RegistrationName") ?? textAt(party, "PartyName", "Name"), "Name des Verkäufers"),
    ustId: textAt(vat, "CompanyID"),
    steuernummer: textAt(other, "CompanyID"),
    strasse: textAt(address, "StreetName"),
    plz: textAt(address, "PostalZone"),
    ort: textAt(address, "CityName"),
    land: textAt(address, "Country", "IdentificationCode"),
    email: textAt(party, "Contact", "ElectronicMail") ?? (attr(endpoint, "schemeID") === "EM" ? text(endpoint) : undefined),
    iban,
  };

  const taxTotals = all(root, "TaxTotal");
  const taxes = all(root, "TaxTotal", "TaxSubtotal").map((t) => ({
    rate: basisPoints(textAt(t, "TaxCategory", "Percent") ?? textAt(t, "Percent")),
    category: textAt(t, "TaxCategory", "ID") ?? "S",
    base: cents(required(textAt(t, "TaxableAmount"), "Steuerbasis")),
    tax: cents(required(textAt(t, "TaxAmount"), "Steuerbetrag")),
  }));

  const lines = all(root, creditNote ? "CreditNoteLine" : "InvoiceLine").map((line) => {
    const quantity = one(line, creditNote ? "CreditedQuantity" : "InvoicedQuantity");
    return {
      description: textAt(line, "Item", "Name") ?? textAt(line, "Item", "Description") ?? "",
      quantity: millis(text(quantity)),
      unitCode: attr(quantity, "unitCode"),
      net: roundedCents(textAt(line, "LineExtensionAmount") ?? "0"),
      taxRate: basisPoints(textAt(line, "Item", "ClassifiedTaxCategory", "Percent")),
    };
  });

  const totals = one(root, "LegalMonetaryTotal");
  const gross = cents(required(textAt(totals, "TaxInclusiveAmount"), "Gesamtbetrag"));
  const taxText = amountIn(taxTotals.map((t) => one(t, "TaxAmount")), currency);
  const payable = textAt(totals, "PayableAmount");
  const deliveryDate = isoDate(textAt(root, "Delivery", "ActualDeliveryDate"));
  const period = one(root, "InvoicePeriod");

  return {
    syntax: "ubl",
    typeCode,
    isCreditNote: creditNote || CREDIT_NOTE_CODES.has(typeCode),
    number: required(textAt(root, "ID"), "Rechnungsnummer"),
    issueDate: required(isoDate(textAt(root, "IssueDate")), "Rechnungsdatum"),
    dueDate: isoDate(textAt(root, "DueDate") ?? paymentMeans.map((m) => textAt(m, "PaymentDueDate")).find(Boolean)),
    currency,
    seller,
    buyerReference: textAt(root, "BuyerReference"),
    serviceFrom: isoDate(textAt(period, "StartDate")) ?? deliveryDate,
    serviceTo: isoDate(textAt(period, "EndDate")) ?? deliveryDate,
    taxes,
    net: cents(required(textAt(totals, "TaxExclusiveAmount"), "Nettosumme")),
    tax: taxText !== undefined ? cents(taxText) : taxes.reduce((sum, t) => sum + t.tax, 0),
    gross,
    duePayable: payable !== undefined ? cents(payable) : gross,
    lines,
    paymentReference: paymentMeans.map((m) => textAt(m, "PaymentID")).find(Boolean),
    iban,
  };
}

// ---------- Dateien ----------

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

/**
 * Liest eine hochgeladene Datei als E-Rechnung.
 * null: PDF ohne eingebettete Rechnungs-XML, Bild oder sonstige Datei.
 * EInvoiceParseError: XML, das sich nicht als E-Rechnung lesen lässt.
 */
export async function readEInvoice(file: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}): Promise<{ invoice: IncomingInvoice; xml: string; source: "zugferd" | "xrechnung" } | null> {
  const mime = file.mimeType.toLowerCase();
  if (mime === "application/pdf" || looksLikePdf(file.bytes)) {
    const embedded = await extractEmbeddedXml(file.bytes);
    if (!embedded) return null;
    return { invoice: parseEInvoiceXml(embedded.xml), xml: embedded.xml, source: "zugferd" };
  }
  if (mime.startsWith("image/")) return null;
  const xmlLike = mime.includes("xml") || file.filename.toLowerCase().endsWith(".xml");
  const xml = decodeXmlBytes(file.bytes);
  if (!xmlLike && !xml.trimStart().startsWith("<")) return null;
  return { invoice: parseEInvoiceXml(xml), xml, source: "xrechnung" };
}
