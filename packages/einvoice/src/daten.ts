import { documentAllowances, lineAmount, netOf, plainFormattedText, TAX_TREATMENTS, treatmentNote, type Cents } from "@haben/core";
import { unitCodeOf } from "./einheit-code.ts";
import { isCreditNote, paidInvoicePayment, presentReferences } from "./format.ts";
import { texts } from "./i18n.ts";
import type { Allowance, DocumentAllowance, Invoice, InvoiceLine } from "./modell.ts";
import type { InvoiceDocument } from "./types.ts";
import { amount, categoryWithRate, netUnitPrice, percent, quantity, withoutInvalidXmlChars } from "./daten-werte.ts";
import { buyerParty, sellerParty } from "./daten-parteien.ts";
import { setDelivery, setPayment } from "./daten-zahlung.ts";

type DocumentLine = InvoiceDocument["lines"][number];
type Allowances = ReturnType<typeof documentAllowances>;

/** Position (BG-25) mit Positionsrabatt, Artikel und Preis */
function invoiceLine(line: DocumentLine, sign: number, grossPrices: boolean, currency: string, doc: InvoiceDocument): InvoiceLine {
  const priceMode = grossPrices ? "brutto" : "netto";
  const net = sign * line.net;
  // Preise sind nie negativ (BR-27); ein Vorzeichen trägt die Menge
  const qty = Math.sign(net || 1) * Math.abs(line.quantity);
  // Netto vor dem Positionsrabatt; der Rabatt ist die Differenz zum Zeilennetto (BT-131 = Menge × Preis − BT-136)
  const before = line.discount ? netOf(lineAmount(line.quantity, line.unitPrice), line.taxRate, priceMode) : line.net;
  const allowance = lineAllowance(line.discount, sign * (before - line.net), sign * before, grossPrices, currency);
  return {
    "cbc:ID": String(line.position),
    "cbc:InvoicedQuantity": quantity(qty),
    "cbc:InvoicedQuantity@unitCode": unitCodeOf(line)!,
    "cbc:LineExtensionAmount": amount(net),
    "cbc:LineExtensionAmount@currencyID": currency,
    ...(allowance ? { "cac:AllowanceCharge": [allowance] } : {}),
    "cac:Item": {
      // Beschreibung (BT-154) steht im UBL-Schema vor dem Namen (BT-153)
      ...(line.detail?.trim() ? { "cbc:Description": plainFormattedText(line.detail.trim()) } : {}),
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
}

/** Abzüge auf Belegebene (BG-20) je Steuersatz */
function documentAllowanceCharges(doc: InvoiceDocument, allowances: Allowances, sign: number, grossPrices: boolean, currency: string): DocumentAllowance[] {
  return allowances.map(
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

/**
 * InvoiceDocument → Rechnungsmodell nach EN 16931 (modell.ts), aus dem cii.ts und ubl.ts das XML schreiben.
 * Storno und Korrektur werden als Gutschrift (381) mit umgekehrtem Vorzeichen abgebildet.
 */
export function toEInvoiceData(doc: InvoiceDocument): Invoice {
  const { buyer } = doc;
  const credit = isCreditNote(doc);
  const sign = credit ? -1 : 1;
  // Code laut ISO 4217; geprüft beim Speichern (CURRENCY_CODE) und in validateForFormat (codelisten.ts)
  const currency = doc.currency;
  const treatment = doc.taxTreatment ?? "regulaer";
  // BR-O-02: bei nicht steuerbaren Umsätzen keine USt-IdNr. von Verkäufer und Käufer
  const outOfScope = TAX_TREATMENTS[treatment].category === "O";
  const exemption = treatment === "regulaer" ? null : TAX_TREATMENTS[treatment];

  const grossPrices = doc.priceMode === "brutto";
  const priceMode = grossPrices ? "brutto" : "netto";
  const lines = doc.lines.map((line) => invoiceLine(line, sign, grossPrices, currency, doc));
  // Gesamtrabatt je Steuersatz (BG-20), abgeleitet aus Zeilennetto und Steuerzeilen wie gespeichert
  const allowances = doc.discount ? documentAllowances(doc.lines, doc.totals, priceMode).filter((a) => a.net !== 0) : [];
  const allowanceTotal = allowances.reduce((s, a) => s + a.net, 0);
  const linesTotal = doc.lines.reduce((s, l) => s + l.net, 0);
  const [firstLine, ...otherLines] = lines;
  if (!firstLine) throw new Error("Rechnung ohne Positionen");

  const payable = sign * doc.totals.gross;
  const paid = paidInvoicePayment(doc);
  const invoice: Invoice = {
    "cbc:ID": doc.number,
    "cbc:IssueDate": doc.issueDate,
    // 326 = Teilrechnung (Abschlag); die Schlussrechnung ist eine normale Rechnung
    "cbc:InvoiceTypeCode": credit ? "381" : doc.variant === "abschlag" ? "326" : "380",
    "cbc:DocumentCurrencyCode": currency,
    "cbc:BuyerReference": buyer.leitwegId ?? buyer.kundennummer ?? doc.number,
    "cac:AccountingSupplierParty": sellerParty(doc, outOfScope),
    "cac:AccountingCustomerParty": buyerParty(doc, outOfScope),
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
      ...(paid ? { "cbc:PrepaidAmount": amount(payable), "cbc:PrepaidAmount@currencyID": currency } : {}),
      "cbc:PayableAmount": amount(paid ? 0 : payable),
      "cbc:PayableAmount@currencyID": currency,
    },
    "cac:InvoiceLine": [firstLine, ...otherLines],
  };

  if (allowances.length > 0) invoice["cac:AllowanceCharge"] = documentAllowanceCharges(doc, allowances, sign, grossPrices, currency);

  // Fremdwährung: Steuerwährung Euro (BT-6) und die Umsatzsteuer in Euro als zweite Steuersumme ohne Aufschlüsselung (BT-111)
  if (doc.euroTax && currency !== "EUR") {
    invoice["cbc:TaxCurrencyCode"] = "EUR";
    invoice["cac:TaxTotal"].push({ "cbc:TaxAmount": amount(sign * doc.euroTax.tax), "cbc:TaxAmount@currencyID": "EUR" });
  }

  // Fester Aufbewahrungshinweis (§ 14 Abs. 4 Nr. 9 UStG) zusätzlich zu den Nutzereingaben als BT-22.
  // KoSIT XRechnung 3.0.2, Abschnitt 11.17 (BT-22), nennt diesen Hinweis ausdrücklich:
  // https://xeinkauf.de/app/uploads/2024/07/XRechnung-v3.0.2.pdf#page=61
  const notes = [doc.intro, doc.propertyRetention ? texts(doc.language).propertyRetention : null, doc.note]
    .map((n) => plainFormattedText(n?.trim() ?? ""))
    .filter(Boolean);
  if (notes.length > 0) invoice["cbc:Note"] = notes;

  setDelivery(invoice, doc);

  Object.assign(invoice, orderReferences(doc));

  const references = [...(doc.corrects ? [doc.corrects] : []), ...(doc.deducted ?? [])];
  if (references.length > 0) {
    invoice["cac:BillingReference"] = references.map((ref) => ({
      "cac:InvoiceDocumentReference": { "cbc:ID": ref.number, "cbc:IssueDate": ref.issueDate },
    }));
  }

  setPayment(invoice, doc, credit);

  return withoutInvalidXmlChars(invoice);
}

/**
 * Bestellnummer des Kunden (BT-13) und eigene Auftragsnummer (BT-14) in cac:OrderReference, Lieferschein (BT-16) in
 * cac:DespatchDocumentReference. cbc:ID ist in cac:OrderReference Pflicht: ohne Bestellnummer steht dort „NA“
 * (PEPPOL BIS Billing 3.0, cac:OrderReference/cbc:ID). Im CII entfällt das, BT-13 fehlt dann einfach.
 */
function orderReferences(doc: InvoiceDocument): Pick<Invoice, "cac:OrderReference" | "cac:DespatchDocumentReference"> {
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
function lineAllowance(discount: InvoiceDocument["discount"], value: Cents, base: Cents, grossPrices: boolean, currency: string): Allowance | null {
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
