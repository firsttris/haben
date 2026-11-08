import { InvoiceService, type Invoice, type Logger } from "@e-invoice-eu/core";
import {
  documentAllowances,
  formatEuro,
  formatPercent,
  lineAmount,
  netOf,
  skontoPaymentTerms,
  TAX_TREATMENTS,
  treatmentNote,
  UNITS,
  type Cents,
  type Millis,
} from "@haben/core";
import { ciiPostProcessor } from "./cii.ts";
import { accountHolder, compactIban, formatDate, invoiceSkonto, isCreditNote, paymentSentence, presentReferences, servicePeriod } from "./format.ts";
import { legalLine, renderInvoicePdf } from "./pdf.ts";
import type { InvoiceDocument, InvoiceFormat } from "./types.ts";
import { validateForFormat } from "./validate.ts";
import { extractFacturXXml } from "./zugferd.ts";

type UblInvoice = Invoice["ubl:Invoice"];
type InvoiceLine = UblInvoice["cac:InvoiceLine"][number];
type LineAllowance = NonNullable<InvoiceLine["cac:AllowanceCharge"]>[number];
type DocumentAllowance = NonNullable<UblInvoice["cac:AllowanceCharge"]>[number];
type CountryCode = UblInvoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:PostalAddress"]["cac:Country"]["cbc:IdentificationCode"];

const SERVICE_FORMATS: Record<InvoiceFormat, string> = {
  zugferd: "Factur-X-EN16931",
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

function percent(rate: number): string {
  return String(rate / 100);
}

type TaxCategoryCode = "S" | "Z" | "E" | "AE" | "K" | "G" | "O";

/** Steuerkategorie (UNTDID 5305): Behandlung der Rechnung, sonst S bzw. Z für den Nullsatz */
function taxCategory(doc: InvoiceDocument, rate: number): TaxCategoryCode {
  const treatment = doc.taxTreatment ?? "regulaer";
  if (treatment !== "regulaer") return TAX_TREATMENTS[treatment].category;
  return rate === 0 ? "Z" : "S";
}

/**
 * Kategorie und Satz. Bei „nicht steuerbar“ (O) darf in der Position kein Satz stehen (BR-O-05);
 * in der Steueraufschlüsselung verlangt XRechnung ihn trotzdem (BR-DE-14), dort steht 0.
 */
function categoryWithRate(doc: InvoiceDocument, rate: number, place: "line" | "breakdown") {
  const id = taxCategory(doc, rate);
  const withRate = id !== "O" || place === "breakdown";
  return { "cbc:ID": id, ...(withRate ? { "cbc:Percent": percent(rate) } : {}), "cac:TaxScheme": { "cbc:ID": "VAT" } };
}

/**
 * Verkäufer als juristische Person (BG-4): Name (BT-27), bei GmbH und UG die Handelsregisternummer als Kennung aus
 * einem amtlichen Register (BT-30, ohne Schema: ISO/IEC 6523 kennt das deutsche Handelsregister nicht) und die
 * Pflichtangaben nach § 35a GmbHG als „Seller additional legal information“ (BT-33, in CII ram:Description).
 * Quelle: EN 16931-1, Semantisches Datenmodell, BG-4.
 */
function sellerLegalEntity(seller: InvoiceDocument["seller"]) {
  const legal = legalLine(seller.legalInfo);
  return {
    "cbc:RegistrationName": seller.name,
    ...(seller.legalInfo?.registerNumber ? { "cbc:CompanyID": seller.legalInfo.registerNumber } : {}),
    ...(legal ? { "cbc:CompanyLegalForm": legal } : {}),
  };
}

/**
 * InvoiceDocument → internes Format von e-invoice-eu (UBL-förmiges JSON).
 * Storno und Korrektur werden als Gutschrift (381) mit umgekehrtem Vorzeichen abgebildet.
 */
export function toEInvoiceData(doc: InvoiceDocument): Invoice {
  const { seller, buyer } = doc;
  const credit = isCreditNote(doc);
  const sign = credit ? -1 : 1;
  // Code laut ISO 4217; geprüft beim Speichern (CURRENCY_CODE), hier nur für die Typen des Formats
  const currency = doc.currency as UblInvoice["cbc:DocumentCurrencyCode"];
  const period = servicePeriod(doc);
  const treatment = doc.taxTreatment ?? "regulaer";
  // BR-O-02: bei nicht steuerbaren Umsätzen keine USt-IdNr. von Verkäufer und Käufer
  const outOfScope = treatment === "drittland";
  const exemption = treatment === "regulaer" ? null : TAX_TREATMENTS[treatment];

  const sellerTax: { "cbc:CompanyID": string; "cac:TaxScheme": { "cbc:ID": string } }[] = [];
  if (seller.ustId && !outOfScope) sellerTax.push({ "cbc:CompanyID": seller.ustId, "cac:TaxScheme": { "cbc:ID": "VAT" } });
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

  const grossPrices = doc.priceMode === "brutto";
  const priceMode = grossPrices ? "brutto" : "netto";
  const lines = doc.lines.map((line): InvoiceLine => {
    const net = sign * line.net;
    // Preise sind nie negativ (BR-27); ein Vorzeichen trägt die Menge
    const qty = Math.sign(net || 1) * Math.abs(line.quantity);
    // Netto vor dem Positionsrabatt; der Rabatt ist die Differenz zum Zeilennetto (BT-131 = Menge × Preis − BT-136)
    const before = line.discount ? netOf(lineAmount(line.quantity, line.unitPrice), line.taxRate, priceMode) : line.net;
    const allowance = lineAllowance(line.discount, sign * (before - line.net), sign * before, grossPrices, currency);
    return {
      "cbc:ID": String(line.position),
      "cbc:InvoicedQuantity": quantity(qty),
      "cbc:InvoicedQuantity@unitCode": UNITS[line.unit],
      "cbc:LineExtensionAmount": amount(net),
      "cbc:LineExtensionAmount@currencyID": currency,
      ...(allowance ? { "cac:AllowanceCharge": [allowance] } : {}),
      "cac:Item": {
        // Beschreibung (BT-154) steht im UBL-Schema vor dem Namen (BT-153)
        ...(line.detail?.trim() ? { "cbc:Description": line.detail.trim() } : {}),
        "cbc:Name": line.description,
        // Artikelnummer des Verkäufers (BT-155), im UBL-Schema hinter dem Namen; im CII ram:SellerAssignedID
        ...(line.itemNumber?.trim() ? { "cac:SellersItemIdentification": { "cbc:ID": line.itemNumber.trim() } } : {}),
        "cac:ClassifiedTaxCategory": categoryWithRate(doc, line.taxRate, "line") as InvoiceLine["cac:Item"]["cac:ClassifiedTaxCategory"],
      },
      "cac:Price": {
        // Bei Bruttopreisen steht im XML der Nettopreis (BT-146), mit mehr Nachkommastellen
        "cbc:PriceAmount": grossPrices ? netUnitPrice(before, line.quantity) : amount(Math.abs(line.unitPrice)),
        "cbc:PriceAmount@currencyID": currency,
      },
    };
  });
  // Gesamtrabatt je Steuersatz (BG-20), abgeleitet aus Zeilennetto und Steuerzeilen wie gespeichert
  const allowances = doc.discount ? documentAllowances(doc.lines, doc.totals, priceMode).filter((a) => a.net !== 0) : [];
  const allowanceTotal = allowances.reduce((s, a) => s + a.net, 0);
  const linesTotal = doc.lines.reduce((s, l) => s + l.net, 0);
  const [firstLine, ...otherLines] = lines;
  if (!firstLine) throw new Error("Rechnung ohne Positionen");

  const payable = sign * doc.totals.gross;
  const invoice: UblInvoice = {
    "cbc:ID": doc.number,
    "cbc:IssueDate": doc.issueDate,
    // 326 = Teilrechnung (Abschlag); die Schlussrechnung ist eine normale Rechnung
    "cbc:InvoiceTypeCode": credit ? "381" : doc.variant === "abschlag" ? "326" : "380",
    "cbc:DocumentCurrencyCode": currency,
    "cbc:BuyerReference": buyer.leitwegId ?? buyer.kundennummer ?? doc.number,
    "cac:AccountingSupplierParty": {
      "cac:Party": {
        "cbc:EndpointID": seller.email,
        "cbc:EndpointID@schemeID": "EM",
        // BR-CO-26: ohne USt-IdNr. dient die Steuernummer als Verkäuferkennung (BT-29)
        ...((!seller.ustId || outOfScope) && (seller.steuernummer || seller.ustId)
          ? { "cac:PartyIdentification": [{ "cbc:ID": seller.steuernummer || seller.ustId! }] }
          : {}),
        "cac:PostalAddress": {
          "cbc:StreetName": seller.strasse,
          "cbc:CityName": seller.ort,
          "cbc:PostalZone": seller.plz,
          "cac:Country": { "cbc:IdentificationCode": seller.land.toUpperCase() as CountryCode },
        },
        ...(sellerTax.length > 0 ? { "cac:PartyTaxScheme": sellerTax as UblInvoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"] } : {}),
        "cac:PartyLegalEntity": sellerLegalEntity(seller),
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
        ...(buyer.ustId && !outOfScope ? { "cac:PartyTaxScheme": { "cbc:CompanyID": buyer.ustId, "cac:TaxScheme": { "cbc:ID": "VAT" } } } : {}),
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
            ...categoryWithRate(doc, t.rate, "breakdown"),
            // BR-E-10, BR-AE-10, BR-O-10: Befreiungsgrund als Code und/oder Text
            ...(exemption?.reasonCode ? { "cbc:TaxExemptionReasonCode": exemption.reasonCode } : {}),
            ...(exemption ? { "cbc:TaxExemptionReason": treatmentNote(treatment, doc.exemptionReason)! } : {}),
          },
        })),
      },
    ],
    "cac:LegalMonetaryTotal": {
      // BR-CO-10: Summe der Positionen; BR-CO-13: abzüglich der Abzüge auf Belegebene ergibt das Netto
      "cbc:LineExtensionAmount": amount(sign * (allowances.length > 0 ? linesTotal : doc.totals.net)),
      "cbc:LineExtensionAmount@currencyID": currency,
      "cbc:TaxExclusiveAmount": amount(sign * doc.totals.net),
      "cbc:TaxExclusiveAmount@currencyID": currency,
      ...(allowances.length > 0 ? { "cbc:AllowanceTotalAmount": amount(sign * allowanceTotal), "cbc:AllowanceTotalAmount@currencyID": currency } : {}),
      "cbc:TaxInclusiveAmount": amount(payable),
      "cbc:TaxInclusiveAmount@currencyID": currency,
      "cbc:PayableAmount": amount(payable),
      "cbc:PayableAmount@currencyID": currency,
    },
    "cac:InvoiceLine": [firstLine, ...otherLines],
  };

  if (allowances.length > 0) {
    invoice["cac:AllowanceCharge"] = allowances.map(
      (a): DocumentAllowance => ({
        "cbc:ChargeIndicator": "false",
        "cbc:AllowanceChargeReasonCode": "95",
        "cbc:AllowanceChargeReason": "Rabatt",
        // Prozent und Grundlage (BT-94, BT-93) nur, wo der Abzug genau Grundlage × Prozent ist: Nettopreise
        ...(doc.discount?.kind === "prozent" && !grossPrices ? { "cbc:MultiplierFactorNumeric": percent(doc.discount.value) } : {}),
        "cbc:Amount": amount(sign * a.net),
        "cbc:Amount@currencyID": currency,
        ...(doc.discount?.kind === "prozent" && !grossPrices ? { "cbc:BaseAmount": amount(sign * a.basis), "cbc:BaseAmount@currencyID": currency } : {}),
        // Wie die Position: bei „nicht steuerbar“ ohne Satz (BR-O-06)
        "cac:TaxCategory": categoryWithRate(doc, a.rate, "line") as DocumentAllowance["cac:TaxCategory"],
      }),
    );
  }

  // Fremdwährung: Steuerwährung Euro (BT-6) und die Umsatzsteuer in Euro als zweite Steuersumme ohne Aufschlüsselung (BT-111)
  if (doc.euroTax && currency !== "EUR") {
    invoice["cbc:TaxCurrencyCode"] = "EUR";
    invoice["cac:TaxTotal"].push({ "cbc:TaxAmount": amount(sign * doc.euroTax.tax), "cbc:TaxAmount@currencyID": "EUR" });
  }

  // Einleitung und Hinweis als Freitext zur Rechnung (BT-22), in der Reihenfolge wie auf dem PDF
  const notes = [doc.intro, doc.note].map((n) => n?.trim() ?? "").filter(Boolean);
  if (notes.length > 0) invoice["cbc:Note"] = notes;

  // BR-IC-12: Bei der innergemeinschaftlichen Lieferung ist das Lieferland (BT-80) Pflicht, mit der Lieferanschrift
  // (BG-15) verlangt XRechnung auch Ort und Postleitzahl (BR-DE-10, BR-DE-11). Haben kennt keine eigene Lieferanschrift;
  // die Anschrift des Kunden ist der Bestimmungsort (siehe docs/rechnungen.md).
  const deliveryLocation =
    treatment === "ig_lieferung"
      ? {
          "cac:DeliveryLocation": {
            "cac:Address": {
              "cbc:StreetName": buyer.strasse,
              "cbc:CityName": buyer.ort,
              "cbc:PostalZone": buyer.plz,
              "cac:Country": { "cbc:IdentificationCode": buyer.land.toUpperCase() as CountryCode },
            },
          },
        }
      : {};
  if (period.from === period.to) {
    invoice["cac:Delivery"] = { "cbc:ActualDeliveryDate": period.from, ...deliveryLocation };
  } else {
    invoice["cac:InvoicePeriod"] = { "cbc:StartDate": period.from, "cbc:EndDate": period.to };
    if (treatment === "ig_lieferung") invoice["cac:Delivery"] = deliveryLocation;
  }

  Object.assign(invoice, orderReferences(doc));

  const references = [...(doc.corrects ? [doc.corrects] : []), ...(doc.deducted ?? [])];
  if (references.length > 0) {
    invoice["cac:BillingReference"] = references.map((ref) => ({
      "cac:InvoiceDocumentReference": { "cbc:ID": ref.number, "cbc:IssueDate": ref.issueDate },
    }));
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
            // BT-85 Name des Zahlungskontos: der Kontoinhaber, sonst der Firmenname
            "cbc:Name": accountHolder(seller),
            ...(seller.bic ? { "cac:FinancialInstitutionBranch": { "cbc:ID": seller.bic } } : {}),
          },
        },
      ];
    } else {
      // Nichts zu zahlen und keine IBAN: BG-16 ist trotzdem Pflicht (BR-DE-1), Zahlungsweg nicht festgelegt
      invoice["cac:PaymentMeans"] = [{ "cbc:PaymentMeansCode": "1", "cbc:PaymentID": doc.number }];
    }
    invoice["cac:PaymentTerms"] = { "cbc:Note": paymentTerms(doc) };
  } else {
    // Erstattung an den Kunden: Zahlungsweg nicht festgelegt
    invoice["cac:PaymentMeans"] = [{ "cbc:PaymentMeansCode": "1", "cbc:PaymentID": doc.number }];
    invoice["cac:PaymentTerms"] = { "cbc:Note": paymentSentence(doc) };
  }

  return withoutInvalidXmlChars({ "ubl:Invoice": invoice });
}

/**
 * Bestellnummer des Kunden (BT-13) und eigene Auftragsnummer (BT-14) in cac:OrderReference, Lieferschein (BT-16) in
 * cac:DespatchDocumentReference. cbc:ID ist in cac:OrderReference Pflicht: ohne Bestellnummer steht dort „NA“
 * (PEPPOL BIS Billing 3.0, cac:OrderReference/cbc:ID). Im CII entfällt das, BT-13 fehlt dann einfach.
 */
function orderReferences(doc: InvoiceDocument): Pick<UblInvoice, "cac:OrderReference" | "cac:DespatchDocumentReference"> {
  const { buyerOrder, sellerOrder, despatchAdvice } = presentReferences(doc.references);
  return {
    ...(buyerOrder || sellerOrder
      ? { "cac:OrderReference": { "cbc:ID": buyerOrder ?? "NA", ...(sellerOrder ? { "cbc:SalesOrderID": sellerOrder } : {}) } }
      : {}),
    ...(despatchAdvice ? { "cac:DespatchDocumentReference": { "cbc:ID": despatchAdvice } } : {}),
  };
}

/**
 * Positionsrabatt als Line allowance (BG-27): Grund „Rabatt“ mit Code 95 (UNTDID 5189, BR-42), Betrag netto (BT-136); bei
 * Prozent und Nettopreisen auch Grundlage (BT-137) und Prozent (BT-138), denn nur dort ist der Abzug genau Grundlage × Prozent.
 */
function lineAllowance(
  discount: InvoiceDocument["discount"],
  value: Cents,
  base: Cents,
  grossPrices: boolean,
  currency: UblInvoice["cbc:DocumentCurrencyCode"],
): LineAllowance | null {
  if (!discount || value === 0) return null;
  const withPercent = discount.kind === "prozent" && !grossPrices;
  return {
    "cbc:ChargeIndicator": "false",
    "cbc:AllowanceChargeReasonCode": "95",
    "cbc:AllowanceChargeReason": "Rabatt",
    ...(withPercent ? { "cbc:MultiplierFactorNumeric": percent(discount.value) } : {}),
    "cbc:Amount": amount(value),
    "cbc:Amount@currencyID": currency,
    ...(withPercent ? { "cbc:BaseAmount": amount(base), "cbc:BaseAmount@currencyID": currency } : {}),
  };
}

/**
 * Zahlungsbedingungen (BT-20): bei Skonto zuerst je Stufe die Zeile nach XRechnung BR-DE-18 (#SKONTO#TAGE=…#PROZENT=…#
 * mit Zeilenumbruch), die Empfänger maschinell lesen, danach derselbe Inhalt als Satz mit Datum und Betrag
 */
function paymentTerms(doc: InvoiceDocument): string {
  const skonto = invoiceSkonto(doc);
  const text = [
    `Zahlbar ohne Abzug bis zum ${formatDate(doc.dueDate)} (${doc.paymentTermDays} Tage).`,
    ...skonto.map((s) => `Bei Zahlung bis zum ${formatDate(s.until)} (${s.days} Tage) ${formatPercent(s.percent)} Skonto, ${formatEuro(s.amount)}.`),
  ].join(" ");
  return `${skontoPaymentTerms(skonto)}${text}`;
}

/** Entfernt in XML 1.0 unzulässige Zeichen aus allen Texten (etwa ein aus Word kopierter vertikaler Tab), sonst lehnt der Empfänger das XML ab; auch aus den Referenzen, die der CII-Post-Processor danach einsetzt */
function withoutInvalidXmlChars<T>(value: T): T {
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

const quietLogger: Logger = {
  log: () => {},
  warn: () => {},
  error: (message) => console.error(message),
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
      postProcessor: ciiPostProcessor(withoutInvalidXmlChars(doc.references)),
    });
    const xml = typeof pdf === "string" ? null : extractFacturXXml(pdf);
    if (typeof pdf === "string" || !xml) throw new Error("ZUGFeRD-Erzeugung lieferte kein PDF mit factur-x.xml");
    return { xml, pdf };
  }

  const xml = await generateXml(data, SERVICE_FORMATS[doc.format], doc);
  return { xml, pdf: visual };
}

async function generateXml(data: Invoice, format: string, doc: InvoiceDocument): Promise<string> {
  const result = await invoiceService().generate(structuredClone(data), {
    format,
    lang: "de-de",
    noWarnings: true,
    postProcessor: ciiPostProcessor(withoutInvalidXmlChars(doc.references)),
  });
  if (typeof result !== "string") throw new Error(`${format} lieferte kein XML`);
  return result;
}
