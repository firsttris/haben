/*
 * Rechnungsmodell nach EN 16931, wie toEInvoiceData (xml.ts) es baut und cii.ts und ubl.ts es schreiben: nur die
 * Felder, die Haben füllt. Die Namen sind die der UBL-Elemente (EN 16931-3-2), Attribute stehen als „Element@Attribut“;
 * so lässt sich ubl.ts ohne Zuordnungstabelle schreiben. Beträge sind fertig formatierte Zahlen ("1234.56").
 */

export interface Address {
  "cbc:StreetName": string;
  "cbc:CityName": string;
  "cbc:PostalZone": string;
  "cac:Country": { "cbc:IdentificationCode": string };
}

export interface TaxScheme {
  "cbc:ID": string;
}

export interface TaxCategory {
  /** Steuerkategorie nach UNTDID 5305 (BT-151, BT-118, BT-95) */
  "cbc:ID": string;
  "cbc:Percent"?: string;
  "cbc:TaxExemptionReasonCode"?: string;
  "cbc:TaxExemptionReason"?: string;
  "cac:TaxScheme": TaxScheme;
}

export interface PartyIdentification {
  "cbc:ID": string;
  /** SEPA: Gläubiger-ID (BT-90), steht im CII nicht beim Verkäufer */
  "cbc:ID@schemeID"?: "SEPA";
}

export interface Party {
  "cbc:EndpointID"?: string;
  "cbc:EndpointID@schemeID"?: string;
  "cac:PartyIdentification"?: PartyIdentification | PartyIdentification[];
  "cac:PostalAddress": Address;
  "cac:PartyTaxScheme"?: { "cbc:CompanyID": string; "cac:TaxScheme": TaxScheme } | { "cbc:CompanyID": string; "cac:TaxScheme": TaxScheme }[];
  "cac:PartyLegalEntity": { "cbc:RegistrationName": string; "cbc:CompanyID"?: string; "cbc:CompanyLegalForm"?: string };
  "cac:Contact"?: { "cbc:Name"?: string; "cbc:Telephone"?: string; "cbc:ElectronicMail"?: string };
}

export interface Allowance {
  "cbc:ChargeIndicator": "false";
  "cbc:AllowanceChargeReasonCode": string;
  "cbc:AllowanceChargeReason": string;
  "cbc:MultiplierFactorNumeric"?: string;
  "cbc:Amount": string;
  "cbc:Amount@currencyID": string;
  "cbc:BaseAmount"?: string;
  "cbc:BaseAmount@currencyID"?: string;
}

/** Abzug auf Belegebene (BG-20) mit Steuerkategorie */
export interface DocumentAllowance extends Allowance {
  "cac:TaxCategory": TaxCategory;
}

export interface InvoiceLine {
  "cbc:ID": string;
  "cbc:InvoicedQuantity": string;
  "cbc:InvoicedQuantity@unitCode": string;
  "cbc:LineExtensionAmount": string;
  "cbc:LineExtensionAmount@currencyID": string;
  "cac:AllowanceCharge"?: Allowance[];
  "cac:Item": {
    "cbc:Description"?: string;
    "cbc:Name": string;
    "cac:SellersItemIdentification"?: { "cbc:ID": string };
    "cac:ClassifiedTaxCategory": TaxCategory;
  };
  "cac:Price": { "cbc:PriceAmount": string; "cbc:PriceAmount@currencyID": string };
}

export interface TaxSubtotal {
  "cbc:TaxableAmount": string;
  "cbc:TaxableAmount@currencyID": string;
  "cbc:TaxAmount": string;
  "cbc:TaxAmount@currencyID": string;
  "cac:TaxCategory": TaxCategory;
}

export interface TaxTotal {
  "cbc:TaxAmount": string;
  "cbc:TaxAmount@currencyID": string;
  "cac:TaxSubtotal"?: TaxSubtotal[];
}

export interface PaymentMeans {
  /** UNTDID 4461: 58 SEPA-Überweisung, 59 SEPA-Lastschrift, 1 nicht festgelegt */
  "cbc:PaymentMeansCode": string;
  "cbc:PaymentID": string;
  "cac:PayeeFinancialAccount"?: { "cbc:ID": string; "cbc:Name": string; "cac:FinancialInstitutionBranch"?: { "cbc:ID": string } };
  "cac:PaymentMandate"?: { "cbc:ID": string; "cac:PayerFinancialAccount": { "cbc:ID": string } };
}

export interface Delivery {
  "cbc:ActualDeliveryDate"?: string;
  "cac:DeliveryLocation"?: { "cac:Address": Address };
}

export interface Invoice {
  "cbc:ID": string;
  "cbc:IssueDate": string;
  "cbc:DueDate"?: string;
  /** UNTDID 1001: 380 Rechnung, 326 Teilrechnung, 381 Gutschrift */
  "cbc:InvoiceTypeCode": string;
  "cbc:Note"?: string[];
  "cbc:DocumentCurrencyCode": string;
  "cbc:TaxCurrencyCode"?: string;
  "cbc:BuyerReference": string;
  "cac:InvoicePeriod"?: { "cbc:StartDate": string; "cbc:EndDate": string };
  "cac:OrderReference"?: { "cbc:ID": string; "cbc:SalesOrderID"?: string };
  "cac:BillingReference"?: { "cac:InvoiceDocumentReference": { "cbc:ID": string; "cbc:IssueDate": string } }[];
  "cac:DespatchDocumentReference"?: { "cbc:ID": string };
  "cac:AccountingSupplierParty": { "cac:Party": Party };
  "cac:AccountingCustomerParty": { "cac:Party": Party };
  "cac:Delivery"?: Delivery;
  "cac:PaymentMeans"?: PaymentMeans[];
  "cac:PaymentTerms"?: { "cbc:Note": string };
  "cac:AllowanceCharge"?: DocumentAllowance[];
  "cac:TaxTotal": TaxTotal[];
  "cac:LegalMonetaryTotal": {
    "cbc:LineExtensionAmount": string;
    "cbc:LineExtensionAmount@currencyID": string;
    "cbc:TaxExclusiveAmount": string;
    "cbc:TaxExclusiveAmount@currencyID": string;
    "cbc:AllowanceTotalAmount"?: string;
    "cbc:AllowanceTotalAmount@currencyID"?: string;
    "cbc:TaxInclusiveAmount": string;
    "cbc:TaxInclusiveAmount@currencyID": string;
    "cbc:PayableAmount": string;
    "cbc:PayableAmount@currencyID": string;
  };
  "cac:InvoiceLine": InvoiceLine[];
}
