import type { Address, Allowance, DocumentAllowance, Invoice, InvoiceLine as Line, Party, PaymentMeans, TaxCategory, TaxSubtotal } from "./modell.ts";
import { el, elIf, txt, type XmlElement, xmlDocument } from "./xml-baum.ts";

/*
 * CII (UN/CEFACT Cross Industry Invoice D16B) für XRechnung CII und Factur-X EN 16931, aus dem Rechnungsmodell nach
 * EN 16931, das toEInvoiceData in xml.ts in UBL-Namen baut. Reihenfolge der Elemente nach dem Schema
 * CrossIndustryInvoice_100pD16B.xsd (KoSIT, validator-configuration-xrechnung) bzw. FACTUR-X_EN16931.xsd; die
 * Zuordnung der Felder nach EN 16931-1 mit den Syntax-Bindings in EN 16931-3-3 (CII) und EN 16931-3-2 (UBL).
 */

type Ubl = Invoice;

/** Kennung des Profils in BT-24 */
export type CiiProfile = "xrechnung" | "factur-x";

const GUIDELINE: Record<CiiProfile, string> = {
  xrechnung: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
  "factur-x": "urn:cen.eu:en16931:2017",
};

/** BT-23: Geschäftsprozess wie bisher (PEPPOL BIS Billing 3.0) */
const BUSINESS_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const ROOT_ATTRIBUTES = {
  "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "xsi:schemaLocation":
    "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100 ../schema/D16B%20SCRDM%20(Subset)/uncoupled%20clm/CII/uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd",
  "xmlns:qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
  "xmlns:udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
  "xmlns:rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  "xmlns:ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
};

/** Liste, auch wenn das Modell ein einzelnes Objekt hat */
function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** 2026-10-02 → 20261002 (Format 102 nach UNTDID 2379) */
function date(name: string, value: string | undefined, prefix = "udt"): XmlElement | null {
  if (!value) return null;
  return el(name, [txt(`${prefix}:DateTimeString`, value.replace(/-/g, ""), { format: "102" })]);
}

/** Kategorie und Satz einer Position oder eines Abzugs (BT-151/BT-152, BT-95/BT-96) */
function tradeTax(name: string, category: TaxCategory) {
  return el(name, [txt("ram:TypeCode", "VAT"), txt("ram:CategoryCode", category["cbc:ID"]), txt("ram:RateApplicablePercent", category["cbc:Percent"])]);
}

/** Abzug (BG-20 auf Belegebene mit Steuerkategorie, BG-27 in der Position ohne) */
function allowanceCharge(allowance: Allowance | DocumentAllowance) {
  const category = "cac:TaxCategory" in allowance ? allowance["cac:TaxCategory"] : null;
  return el("ram:SpecifiedTradeAllowanceCharge", [
    el("ram:ChargeIndicator", [txt("udt:Indicator", allowance["cbc:ChargeIndicator"])]),
    txt("ram:CalculationPercent", allowance["cbc:MultiplierFactorNumeric"]),
    txt("ram:BasisAmount", allowance["cbc:BaseAmount"]),
    txt("ram:ActualAmount", allowance["cbc:Amount"]),
    txt("ram:ReasonCode", allowance["cbc:AllowanceChargeReasonCode"]),
    txt("ram:Reason", allowance["cbc:AllowanceChargeReason"]),
    category && tradeTax("ram:CategoryTradeTax", category),
  ]);
}

function lineItem(line: Line) {
  const item = line["cac:Item"];
  return el("ram:IncludedSupplyChainTradeLineItem", [
    el("ram:AssociatedDocumentLineDocument", [txt("ram:LineID", line["cbc:ID"])]),
    el("ram:SpecifiedTradeProduct", [
      txt("ram:SellerAssignedID", item["cac:SellersItemIdentification"]?.["cbc:ID"]),
      txt("ram:Name", item["cbc:Name"]),
      txt("ram:Description", item["cbc:Description"]),
    ]),
    el("ram:SpecifiedLineTradeAgreement", [el("ram:NetPriceProductTradePrice", [txt("ram:ChargeAmount", line["cac:Price"]["cbc:PriceAmount"])])]),
    el("ram:SpecifiedLineTradeDelivery", [txt("ram:BilledQuantity", line["cbc:InvoicedQuantity"], { unitCode: line["cbc:InvoicedQuantity@unitCode"] })]),
    el("ram:SpecifiedLineTradeSettlement", [
      tradeTax("ram:ApplicableTradeTax", item["cac:ClassifiedTaxCategory"]),
      ...list(line["cac:AllowanceCharge"]).map(allowanceCharge),
      el("ram:SpecifiedTradeSettlementLineMonetarySummation", [txt("ram:LineTotalAmount", line["cbc:LineExtensionAmount"])]),
    ]),
  ]);
}

function postalAddress(address: Address | undefined) {
  if (!address) return null;
  return el("ram:PostalTradeAddress", [
    txt("ram:PostcodeCode", address["cbc:PostalZone"]),
    txt("ram:LineOne", address["cbc:StreetName"]),
    txt("ram:CityName", address["cbc:CityName"]),
    txt("ram:CountryID", address["cac:Country"]["cbc:IdentificationCode"]),
  ]);
}

/** UBL-Schema der Steuernummer (cac:TaxScheme) → schemeID in CII: VAT → VA (USt-IdNr.), FC (Steuernummer) bleibt */
function taxRegistrations(party: Party) {
  return list(party["cac:PartyTaxScheme"]).map((scheme) =>
    el("ram:SpecifiedTaxRegistration", [
      txt("ram:ID", scheme["cbc:CompanyID"], { schemeID: scheme["cac:TaxScheme"]["cbc:ID"] === "VAT" ? "VA" : scheme["cac:TaxScheme"]["cbc:ID"] }),
    ]),
  );
}

/** Verkäufer (BG-4) oder Käufer (BG-7); die Gläubiger-ID (schemeID SEPA) steht nicht hier, sondern in BT-90 */
function tradeParty(name: string, party: Party) {
  const legal = party["cac:PartyLegalEntity"];
  const contact = party["cac:Contact"];
  const endpoint = party["cbc:EndpointID"];
  return el(name, [
    ...list(party["cac:PartyIdentification"])
      .filter((id) => !("cbc:ID@schemeID" in id))
      .map((id) => txt("ram:ID", id["cbc:ID"])),
    txt("ram:Name", legal["cbc:RegistrationName"]),
    txt("ram:Description", legal["cbc:CompanyLegalForm"]),
    elIf("ram:SpecifiedLegalOrganization", [txt("ram:ID", legal["cbc:CompanyID"])]),
    contact &&
      el("ram:DefinedTradeContact", [
        txt("ram:PersonName", contact["cbc:Name"]),
        contact["cbc:Telephone"] && el("ram:TelephoneUniversalCommunication", [txt("ram:CompleteNumber", contact["cbc:Telephone"])]),
        contact["cbc:ElectronicMail"] && el("ram:EmailURIUniversalCommunication", [txt("ram:URIID", contact["cbc:ElectronicMail"])]),
      ]),
    postalAddress(party["cac:PostalAddress"]),
    endpoint && el("ram:URIUniversalCommunication", [txt("ram:URIID", endpoint, { schemeID: party["cbc:EndpointID@schemeID"] })]),
    ...taxRegistrations(party),
  ]);
}

function agreement(invoice: Ubl) {
  const order = invoice["cac:OrderReference"];
  const buyerOrder = order?.["cbc:ID"] !== "NA" ? order?.["cbc:ID"] : undefined;
  return el("ram:ApplicableHeaderTradeAgreement", [
    txt("ram:BuyerReference", invoice["cbc:BuyerReference"]),
    tradeParty("ram:SellerTradeParty", invoice["cac:AccountingSupplierParty"]["cac:Party"]),
    tradeParty("ram:BuyerTradeParty", invoice["cac:AccountingCustomerParty"]["cac:Party"]),
    elIf("ram:SellerOrderReferencedDocument", [txt("ram:IssuerAssignedID", order?.["cbc:SalesOrderID"])]),
    elIf("ram:BuyerOrderReferencedDocument", [txt("ram:IssuerAssignedID", buyerOrder)]),
  ]);
}

/** Lieferung (BG-13): Lieferanschrift, Lieferdatum (BT-72), Lieferschein (BT-16); das Element ist auch leer Pflicht */
function delivery(invoice: Ubl) {
  const delivered = invoice["cac:Delivery"];
  const location = list(delivered)[0]?.["cac:DeliveryLocation"]?.["cac:Address"];
  return el("ram:ApplicableHeaderTradeDelivery", [
    location && el("ram:ShipToTradeParty", [postalAddress(location as Address)]),
    date("ram:ActualDeliverySupplyChainEvent", list(delivered)[0]?.["cbc:ActualDeliveryDate"]) &&
      el("ram:ActualDeliverySupplyChainEvent", [date("ram:OccurrenceDateTime", list(delivered)[0]?.["cbc:ActualDeliveryDate"])]),
    ...list(invoice["cac:DespatchDocumentReference"]).map((ref) => el("ram:DespatchAdviceReferencedDocument", [txt("ram:IssuerAssignedID", ref["cbc:ID"])])),
  ]);
}

function paymentMeans(means: PaymentMeans) {
  const payee = means["cac:PayeeFinancialAccount"];
  const payer = means["cac:PaymentMandate"]?.["cac:PayerFinancialAccount"];
  return el("ram:SpecifiedTradeSettlementPaymentMeans", [
    txt("ram:TypeCode", means["cbc:PaymentMeansCode"]),
    payer && el("ram:PayerPartyDebtorFinancialAccount", [txt("ram:IBANID", payer["cbc:ID"])]),
    payee && el("ram:PayeePartyCreditorFinancialAccount", [txt("ram:IBANID", payee["cbc:ID"]), txt("ram:AccountName", payee["cbc:Name"])]),
    payee?.["cac:FinancialInstitutionBranch"] &&
      el("ram:PayeeSpecifiedCreditorFinancialInstitution", [txt("ram:BICID", payee["cac:FinancialInstitutionBranch"]["cbc:ID"])]),
  ]);
}

/** Steueraufschlüsselung (BG-23) */
function headerTax(subtotal: TaxSubtotal) {
  const category = subtotal["cac:TaxCategory"];
  return el("ram:ApplicableTradeTax", [
    txt("ram:CalculatedAmount", subtotal["cbc:TaxAmount"]),
    txt("ram:TypeCode", "VAT"),
    txt("ram:ExemptionReason", category["cbc:TaxExemptionReason"]),
    txt("ram:BasisAmount", subtotal["cbc:TaxableAmount"]),
    txt("ram:CategoryCode", category["cbc:ID"]),
    txt("ram:ExemptionReasonCode", category["cbc:TaxExemptionReasonCode"]),
    txt("ram:RateApplicablePercent", category["cbc:Percent"]),
  ]);
}

function settlement(invoice: Ubl) {
  const means = list(invoice["cac:PaymentMeans"]);
  const creditor = list(invoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyIdentification"]).find((id) => "cbc:ID@schemeID" in id);
  const period = invoice["cac:InvoicePeriod"];
  const totals = invoice["cac:LegalMonetaryTotal"];
  const mandate = means.find((m) => m["cac:PaymentMandate"])?.["cac:PaymentMandate"];
  return el("ram:ApplicableHeaderTradeSettlement", [
    txt("ram:CreditorReferenceID", creditor?.["cbc:ID"]),
    txt("ram:PaymentReference", means[0]?.["cbc:PaymentID"]),
    txt("ram:TaxCurrencyCode", invoice["cbc:TaxCurrencyCode"]),
    txt("ram:InvoiceCurrencyCode", invoice["cbc:DocumentCurrencyCode"]),
    ...means.map(paymentMeans),
    ...invoice["cac:TaxTotal"].flatMap((total) => list(total["cac:TaxSubtotal"]).map(headerTax)),
    period &&
      el("ram:BillingSpecifiedPeriod", [
        date("ram:StartDateTime", list(period)[0]?.["cbc:StartDate"]),
        date("ram:EndDateTime", list(period)[0]?.["cbc:EndDate"]),
      ]),
    ...list(invoice["cac:AllowanceCharge"]).map(allowanceCharge),
    el("ram:SpecifiedTradePaymentTerms", [
      txt("ram:Description", list(invoice["cac:PaymentTerms"])[0]?.["cbc:Note"]),
      date("ram:DueDateDateTime", invoice["cbc:DueDate"]),
      txt("ram:DirectDebitMandateID", mandate?.["cbc:ID"]),
    ]),
    el("ram:SpecifiedTradeSettlementHeaderMonetarySummation", [
      txt("ram:LineTotalAmount", totals["cbc:LineExtensionAmount"]),
      txt("ram:AllowanceTotalAmount", totals["cbc:AllowanceTotalAmount"]),
      txt("ram:TaxBasisTotalAmount", totals["cbc:TaxExclusiveAmount"]),
      ...invoice["cac:TaxTotal"].map((total) => txt("ram:TaxTotalAmount", total["cbc:TaxAmount"], { currencyID: total["cbc:TaxAmount@currencyID"] })),
      txt("ram:GrandTotalAmount", totals["cbc:TaxInclusiveAmount"]),
      txt("ram:DuePayableAmount", totals["cbc:PayableAmount"]),
    ]),
    ...list(invoice["cac:BillingReference"]).map((ref) =>
      el("ram:InvoiceReferencedDocument", [
        txt("ram:IssuerAssignedID", ref["cac:InvoiceDocumentReference"]["cbc:ID"]),
        date("ram:FormattedIssueDateTime", ref["cac:InvoiceDocumentReference"]["cbc:IssueDate"], "qdt"),
      ]),
    ),
  ]);
}

/** CII einer Rechnung aus dem Modell von toEInvoiceData */
export function ciiXml(invoice: Invoice, profile: CiiProfile): string {
  return xmlDocument(
    el(
      "rsm:CrossIndustryInvoice",
      [
        el("rsm:ExchangedDocumentContext", [
          el("ram:BusinessProcessSpecifiedDocumentContextParameter", [txt("ram:ID", BUSINESS_PROCESS)]),
          el("ram:GuidelineSpecifiedDocumentContextParameter", [txt("ram:ID", GUIDELINE[profile])]),
        ]),
        el("rsm:ExchangedDocument", [
          txt("ram:ID", invoice["cbc:ID"]),
          txt("ram:TypeCode", invoice["cbc:InvoiceTypeCode"]),
          date("ram:IssueDateTime", invoice["cbc:IssueDate"]),
          ...list(invoice["cbc:Note"]).map((note) => el("ram:IncludedNote", [txt("ram:Content", note)])),
        ]),
        el("rsm:SupplyChainTradeTransaction", [...invoice["cac:InvoiceLine"].map(lineItem), agreement(invoice), delivery(invoice), settlement(invoice)]),
      ],
      ROOT_ATTRIBUTES,
    ),
  );
}
