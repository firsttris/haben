import type { Invoice } from "./modell.ts";
import { el, txt, type XmlElement, xmlDocument } from "./xml-baum.ts";

/*
 * UBL 2.1 (Invoice und CreditNote) für XRechnung UBL, aus dem Rechnungsmodell von toEInvoiceData in xml.ts. Dessen
 * Schlüssel sind schon die Namen der UBL-Elemente, Attribute stehen als „Element@Attribut“. Die Reihenfolge der Kinder
 * folgt dem Schema (UBL-Invoice-2.1.xsd, UBL-CreditNote-2.1.xsd, UBL-CommonAggregateComponents-2.1.xsd) für die
 * Elemente, die Haben schreibt; ein Schlüssel ohne Platz in ORDER ist ein Fehler.
 */

const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const PARTY = ["cbc:EndpointID", "cac:PartyIdentification", "cac:PostalAddress", "cac:PartyTaxScheme", "cac:PartyLegalEntity", "cac:Contact"];
const ADDRESS = ["cbc:StreetName", "cbc:CityName", "cbc:PostalZone", "cac:Country"];
const ALLOWANCE = [
  "cbc:ChargeIndicator",
  "cbc:AllowanceChargeReasonCode",
  "cbc:AllowanceChargeReason",
  "cbc:MultiplierFactorNumeric",
  "cbc:Amount",
  "cbc:BaseAmount",
  "cac:TaxCategory",
];
const TAX_CATEGORY = ["cbc:ID", "cbc:Percent", "cbc:TaxExemptionReasonCode", "cbc:TaxExemptionReason", "cac:TaxScheme"];

/** Rechnung; für die Gutschrift gelten dieselben Plätze mit CreditNote statt Invoice (UBL-CreditNote-2.1.xsd) */
const DOCUMENT = [
  "cbc:CustomizationID",
  "cbc:ProfileID",
  "cbc:ID",
  "cbc:IssueDate",
  "cbc:DueDate",
  "cbc:InvoiceTypeCode",
  "cbc:Note",
  "cbc:DocumentCurrencyCode",
  "cbc:TaxCurrencyCode",
  "cbc:BuyerReference",
  "cac:InvoicePeriod",
  "cac:OrderReference",
  "cac:BillingReference",
  "cac:DespatchDocumentReference",
  "cac:AccountingSupplierParty",
  "cac:AccountingCustomerParty",
  "cac:Delivery",
  "cac:PaymentMeans",
  "cac:PaymentTerms",
  "cac:AllowanceCharge",
  "cac:TaxTotal",
  "cac:LegalMonetaryTotal",
  "cac:InvoiceLine",
];

const ORDER: Record<string, string[]> = {
  "cac:InvoicePeriod": ["cbc:StartDate", "cbc:EndDate"],
  "cac:OrderReference": ["cbc:ID", "cbc:SalesOrderID"],
  "cac:BillingReference": ["cac:InvoiceDocumentReference"],
  "cac:InvoiceDocumentReference": ["cbc:ID", "cbc:IssueDate"],
  "cac:DespatchDocumentReference": ["cbc:ID"],
  "cac:AccountingSupplierParty": ["cac:Party"],
  "cac:AccountingCustomerParty": ["cac:Party"],
  "cac:Party": PARTY,
  "cac:PartyIdentification": ["cbc:ID"],
  "cac:PostalAddress": ADDRESS,
  "cac:Address": ADDRESS,
  "cac:Country": ["cbc:IdentificationCode"],
  "cac:PartyTaxScheme": ["cbc:CompanyID", "cac:TaxScheme"],
  "cac:TaxScheme": ["cbc:ID"],
  "cac:PartyLegalEntity": ["cbc:RegistrationName", "cbc:CompanyID", "cbc:CompanyLegalForm"],
  "cac:Contact": ["cbc:Name", "cbc:Telephone", "cbc:ElectronicMail"],
  "cac:Delivery": ["cbc:ActualDeliveryDate", "cac:DeliveryLocation"],
  "cac:DeliveryLocation": ["cac:Address"],
  "cac:PaymentMeans": ["cbc:PaymentMeansCode", "cbc:PaymentID", "cac:PayeeFinancialAccount", "cac:PaymentMandate"],
  "cac:PayeeFinancialAccount": ["cbc:ID", "cbc:Name", "cac:FinancialInstitutionBranch"],
  "cac:FinancialInstitutionBranch": ["cbc:ID"],
  "cac:PaymentMandate": ["cbc:ID", "cac:PayerFinancialAccount"],
  "cac:PayerFinancialAccount": ["cbc:ID"],
  "cac:PaymentTerms": ["cbc:Note"],
  "cac:AllowanceCharge": ALLOWANCE,
  "cac:TaxCategory": TAX_CATEGORY,
  "cac:ClassifiedTaxCategory": TAX_CATEGORY,
  "cac:TaxTotal": ["cbc:TaxAmount", "cac:TaxSubtotal"],
  "cac:TaxSubtotal": ["cbc:TaxableAmount", "cbc:TaxAmount", "cac:TaxCategory"],
  "cac:LegalMonetaryTotal": ["cbc:LineExtensionAmount", "cbc:TaxExclusiveAmount", "cbc:TaxInclusiveAmount", "cbc:AllowanceTotalAmount", "cbc:PayableAmount"],
  "cac:InvoiceLine": ["cbc:ID", "cbc:InvoicedQuantity", "cbc:LineExtensionAmount", "cac:AllowanceCharge", "cac:Item", "cac:Price"],
  "cac:Item": ["cbc:Description", "cbc:Name", "cac:SellersItemIdentification", "cac:ClassifiedTaxCategory"],
  "cac:SellersItemIdentification": ["cbc:ID"],
  "cac:Price": ["cbc:PriceAmount"],
};

type Value = string | Value[] | { [key: string]: Value };

/** Element name aus dem Wert des Modells; Listen ergeben mehrere Elemente gleichen Namens */
function elements(name: string, value: Value, attributes: Record<string, string>, rename: (name: string) => string): XmlElement[] {
  if (Array.isArray(value)) return value.flatMap((item) => elements(name, item, attributes, rename));
  if (typeof value === "string") return [txt(rename(name), value, attributes)].filter((e): e is XmlElement => e !== null);
  return [el(rename(name), children(name, value, ORDER[name], rename), attributes)];
}

function children(parent: string, value: { [key: string]: Value }, order: string[] | undefined, rename: (name: string) => string): XmlElement[] {
  const keys = Object.keys(value).filter((key) => !key.includes("@"));
  for (const key of keys) {
    if (!order?.includes(key)) throw new Error(`UBL: ${key} in ${parent} hat keinen Platz in der Reihenfolge`);
  }
  return order!
    .filter((key) => key in value)
    .flatMap((key) => {
      const attributes = Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => k.startsWith(`${key}@`))
          .map(([k, v]) => [k.slice(key.length + 1), v as string]),
      );
      return elements(key, value[key]!, attributes, rename);
    });
}

/** Gutschrift (381): Wurzel CreditNote, InvoiceLine → CreditNoteLine, InvoicedQuantity → CreditedQuantity, ohne DueDate */
function creditNoteName(name: string): string {
  if (name === "cbc:InvoicedQuantity") return "cbc:CreditedQuantity";
  if (name === "cbc:InvoiceTypeCode") return "cbc:CreditNoteTypeCode";
  if (name === "cac:InvoiceLine") return "cac:CreditNoteLine";
  return name;
}

/** UBL einer Rechnung oder Gutschrift aus dem Modell von toEInvoiceData */
export function ublXml(data: Invoice): string {
  const invoice = { "cbc:CustomizationID": CUSTOMIZATION_ID, "cbc:ProfileID": PROFILE_ID, ...data } as unknown as {
    [key: string]: Value;
  };
  const credit = invoice["cbc:InvoiceTypeCode"] === "381";
  if (credit) delete invoice["cbc:DueDate"];
  const root = credit ? "CreditNote" : "Invoice";
  return xmlDocument(
    el(root, children(root, invoice, DOCUMENT, credit ? creditNoteName : (name) => name), {
      xmlns: `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`,
      "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    }),
  );
}
