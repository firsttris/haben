import { InvoiceService, type Invoice, type InvoiceServiceOptions, type Logger } from "@e-invoice-eu/core";
import { UNITS, type Cents, type Millis } from "@haben/core";
import { compactIban, formatDate, isCreditNote, paymentSentence, servicePeriod } from "./format.ts";
import { renderInvoicePdf } from "./pdf.ts";
import type { InvoiceDocument, InvoiceFormat } from "./types.ts";
import { validateForFormat } from "./validate.ts";
import { extractFacturXXml } from "./zugferd.ts";

type UblInvoice = Invoice["ubl:Invoice"];
type InvoiceLine = UblInvoice["cac:InvoiceLine"][number];
type CountryCode = UblInvoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:PostalAddress"]["cac:Country"]["cbc:IdentificationCode"];

const SERVICE_FORMATS: Record<InvoiceFormat, string> = {
  "zugferd": "Factur-X-EN16931",
  "xrechnung-cii": "XRECHNUNG-CII",
  "xrechnung-ubl": "XRECHNUNG-UBL",
};

/** 123456 → "1234.56" */
function amount(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 152000 → "152", 500 → "0.5" */
function quantity(millis: Millis): string {
  const abs = Math.abs(millis);
  const fraction = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${millis < 0 ? "-" : ""}${Math.floor(abs / 1000)}${fraction ? `.${fraction}` : ""}`;
}

function percent(rate: number): string {
  return String(rate / 100);
}

function taxCategory(rate: number): "S" | "Z" {
  return rate === 0 ? "Z" : "S";
}

/**
 * InvoiceDocument → internes Format von e-invoice-eu (UBL-förmiges JSON).
 * Storno und Korrektur werden als Gutschrift (381) mit umgekehrtem Vorzeichen abgebildet.
 */
export function toEInvoiceData(doc: InvoiceDocument): Invoice {
  const { seller, buyer } = doc;
  const credit = isCreditNote(doc);
  const sign = credit ? -1 : 1;
  const currency = doc.currency;
  const period = servicePeriod(doc);

  const sellerTax: { "cbc:CompanyID": string; "cac:TaxScheme": { "cbc:ID": string } }[] = [];
  if (seller.ustId) sellerTax.push({ "cbc:CompanyID": seller.ustId, "cac:TaxScheme": { "cbc:ID": "VAT" } });
  if (seller.steuernummer) sellerTax.push({ "cbc:CompanyID": seller.steuernummer, "cac:TaxScheme": { "cbc:ID": "FC" } });

  const sellerContact: NonNullable<UblInvoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:Contact"]> = {
    "cbc:Name": seller.name,
    "cbc:ElectronicMail": seller.email,
  };
  if (seller.telefon) sellerContact["cbc:Telephone"] = seller.telefon;

  // BT-49: E-Mail, sonst Leitweg-ID (Schema 0204)
  const buyerEndpoint = buyer.email
    ? { "cbc:EndpointID": buyer.email, "cbc:EndpointID@schemeID": "EM" as const }
    : buyer.leitwegId
      ? { "cbc:EndpointID": buyer.leitwegId, "cbc:EndpointID@schemeID": "0204" as const }
      : {};

  const lines = doc.lines.map((line): InvoiceLine => {
    const net = sign * line.net;
    // Preise sind nie negativ (BR-27); ein Vorzeichen trägt die Menge
    const qty = Math.sign(net || 1) * Math.abs(line.quantity);
    return {
      "cbc:ID": String(line.position),
      "cbc:InvoicedQuantity": quantity(qty),
      "cbc:InvoicedQuantity@unitCode": UNITS[line.unit],
      "cbc:LineExtensionAmount": amount(net),
      "cbc:LineExtensionAmount@currencyID": currency,
      "cac:Item": {
        "cbc:Name": line.description,
        "cac:ClassifiedTaxCategory": {
          "cbc:ID": taxCategory(line.taxRate),
          "cbc:Percent": percent(line.taxRate),
          "cac:TaxScheme": { "cbc:ID": "VAT" },
        },
      },
      "cac:Price": {
        "cbc:PriceAmount": amount(Math.abs(line.unitPrice)),
        "cbc:PriceAmount@currencyID": currency,
      },
    };
  });
  const [firstLine, ...otherLines] = lines;
  if (!firstLine) throw new Error("Rechnung ohne Positionen");

  const gross = sign * doc.totals.gross;
  const invoice: UblInvoice = {
    "cbc:ID": doc.number,
    "cbc:IssueDate": doc.issueDate,
    "cbc:InvoiceTypeCode": credit ? "381" : "380",
    "cbc:DocumentCurrencyCode": currency,
    "cbc:BuyerReference": buyer.leitwegId ?? buyer.kundennummer ?? doc.number,
    "cac:AccountingSupplierParty": {
      "cac:Party": {
        "cbc:EndpointID": seller.email,
        "cbc:EndpointID@schemeID": "EM",
        // BR-CO-26: ohne USt-IdNr. dient die Steuernummer als Verkäuferkennung (BT-29)
        ...(!seller.ustId && seller.steuernummer ? { "cac:PartyIdentification": [{ "cbc:ID": seller.steuernummer }] } : {}),
        "cac:PostalAddress": {
          "cbc:StreetName": seller.strasse,
          "cbc:CityName": seller.ort,
          "cbc:PostalZone": seller.plz,
          "cac:Country": { "cbc:IdentificationCode": seller.land.toUpperCase() as CountryCode },
        },
        "cac:PartyTaxScheme": sellerTax as UblInvoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"],
        "cac:PartyLegalEntity": { "cbc:RegistrationName": seller.name },
        "cac:Contact": sellerContact,
      },
    },
    "cac:AccountingCustomerParty": {
      "cac:Party": {
        ...buyerEndpoint,
        ...(buyer.kundennummer ? { "cac:PartyIdentification": { "cbc:ID": buyer.kundennummer } } : {}),
        "cac:PostalAddress": {
          "cbc:StreetName": buyer.strasse,
          "cbc:CityName": buyer.ort,
          "cbc:PostalZone": buyer.plz,
          "cac:Country": { "cbc:IdentificationCode": buyer.land.toUpperCase() as CountryCode },
        },
        ...(buyer.ustId
          ? { "cac:PartyTaxScheme": { "cbc:CompanyID": buyer.ustId, "cac:TaxScheme": { "cbc:ID": "VAT" } } }
          : {}),
        "cac:PartyLegalEntity": { "cbc:RegistrationName": buyer.name },
        ...(buyer.email ? { "cac:Contact": { "cbc:ElectronicMail": buyer.email } } : {}),
      },
    },
    "cac:TaxTotal": [
      {
        "cbc:TaxAmount": amount(sign * doc.totals.tax),
        "cbc:TaxAmount@currencyID": currency,
        "cac:TaxSubtotal": doc.totals.taxes.map((t) => ({
          "cbc:TaxableAmount": amount(sign * t.base),
          "cbc:TaxableAmount@currencyID": currency,
          "cbc:TaxAmount": amount(sign * t.tax),
          "cbc:TaxAmount@currencyID": currency,
          "cac:TaxCategory": {
            "cbc:ID": taxCategory(t.rate),
            "cbc:Percent": percent(t.rate),
            "cac:TaxScheme": { "cbc:ID": "VAT" },
          },
        })),
      },
    ],
    "cac:LegalMonetaryTotal": {
      "cbc:LineExtensionAmount": amount(sign * doc.totals.net),
      "cbc:LineExtensionAmount@currencyID": currency,
      "cbc:TaxExclusiveAmount": amount(sign * doc.totals.net),
      "cbc:TaxExclusiveAmount@currencyID": currency,
      "cbc:TaxInclusiveAmount": amount(gross),
      "cbc:TaxInclusiveAmount@currencyID": currency,
      "cbc:PayableAmount": amount(gross),
      "cbc:PayableAmount@currencyID": currency,
    },
    "cac:InvoiceLine": [firstLine, ...otherLines],
  };

  if (doc.note?.trim()) invoice["cbc:Note"] = [doc.note.trim()];

  if (period.from === period.to) {
    invoice["cac:Delivery"] = { "cbc:ActualDeliveryDate": period.from };
  } else {
    invoice["cac:InvoicePeriod"] = { "cbc:StartDate": period.from, "cbc:EndDate": period.to };
  }

  if (doc.corrects) {
    invoice["cac:BillingReference"] = [
      { "cac:InvoiceDocumentReference": { "cbc:ID": doc.corrects.number, "cbc:IssueDate": doc.corrects.issueDate } },
    ];
  }

  if (!credit) {
    invoice["cbc:DueDate"] = doc.dueDate;
    if (seller.iban) {
      invoice["cac:PaymentMeans"] = [
        {
          "cbc:PaymentMeansCode": "58",
          "cbc:PaymentID": doc.number,
          "cac:PayeeFinancialAccount": {
            "cbc:ID": compactIban(seller.iban),
            "cbc:Name": seller.name,
            ...(seller.bic ? { "cac:FinancialInstitutionBranch": { "cbc:ID": seller.bic } } : {}),
          },
        },
      ];
    }
    invoice["cac:PaymentTerms"] = {
      "cbc:Note": `Zahlbar ohne Abzug bis zum ${formatDate(doc.dueDate)} (${doc.paymentTermDays} Tage).`,
    };
  } else {
    // Erstattung an den Kunden: Zahlungsweg nicht festgelegt
    invoice["cac:PaymentMeans"] = [{ "cbc:PaymentMeansCode": "1", "cbc:PaymentID": doc.number }];
    invoice["cac:PaymentTerms"] = { "cbc:Note": paymentSentence(doc) };
  }

  return { "ubl:Invoice": invoice };
}

const quietLogger: Logger = {
  log: () => {},
  warn: () => {},
  error: (message) => console.error(message),
};

/**
 * CII verlangt ApplicableHeaderTradeDelivery auch ohne Inhalt; e-invoice-eu
 * lässt es bei reinem Leistungszeitraum weg.
 */
const ensureHeaderTradeDelivery: InvoiceServiceOptions["postProcessor"] = async (data) => {
  const root = (data as Record<string, Record<string, Record<string, unknown>> | undefined>)["rsm:CrossIndustryInvoice"];
  const tx = root?.["rsm:SupplyChainTradeTransaction"];
  if (!root || !tx || "ram:ApplicableHeaderTradeDelivery" in tx) return;
  const ordered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tx)) {
    if (key === "ram:ApplicableHeaderTradeSettlement") ordered["ram:ApplicableHeaderTradeDelivery"] = {};
    ordered[key] = value;
  }
  root["rsm:SupplyChainTradeTransaction"] = ordered;
};

let service: InvoiceService | undefined;

function invoiceService(): InvoiceService {
  service ??= new InvoiceService(quietLogger);
  return service;
}

/**
 * Erzeugt die E-Rechnung im gewünschten Format.
 * zugferd: pdf ist das PDF/A-3 mit eingebettetem factur-x.xml, xml das CII daraus.
 * xrechnung-*: xml ist die Rechnung, pdf die Sichtkopie.
 */
export async function buildEInvoice(doc: InvoiceDocument): Promise<{ xml: string; pdf: Uint8Array }> {
  const problems = validateForFormat(doc);
  if (problems.length > 0) {
    throw new Error(`Rechnung ${doc.number} unvollständig: ${problems.join("; ")}`);
  }
  const data = toEInvoiceData(doc);
  const visual = renderInvoicePdf(doc);

  if (doc.format === "zugferd") {
    const pdf = await invoiceService().generate(structuredClone(data), {
      format: SERVICE_FORMATS.zugferd,
      lang: "de-de",
      pdf: { buffer: visual, filename: `${doc.number}.pdf`, mimetype: "application/pdf" },
      noWarnings: true,
      postProcessor: ensureHeaderTradeDelivery,
    });
    const xml = typeof pdf === "string" ? null : extractFacturXXml(pdf);
    if (typeof pdf === "string" || !xml) throw new Error("ZUGFeRD-Erzeugung lieferte kein PDF mit factur-x.xml");
    return { xml, pdf };
  }

  const xml = await generateXml(data, SERVICE_FORMATS[doc.format]);
  return { xml, pdf: visual };
}

async function generateXml(data: Invoice, format: string): Promise<string> {
  const result = await invoiceService().generate(structuredClone(data), {
    format,
    lang: "de-de",
    noWarnings: true,
    postProcessor: ensureHeaderTradeDelivery,
  });
  if (typeof result !== "string") throw new Error(`${format} lieferte kein XML`);
  return result;
}
