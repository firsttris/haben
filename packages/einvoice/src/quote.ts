import type { InvoiceTotals, TaxTreatment } from "@haben/core";
import { texts, type Language } from "./i18n.ts";
import { addressLines, footerColumns, renderQuotePdfData, templateLabels } from "./pdf.ts";
import type { Buyer, InvoiceDocumentLine, Logo, Seller } from "./types.ts";

/** Angebot: wie eine Rechnung aufgebaut, aber ohne Zahlungsaufforderung und ohne E-Rechnungs-XML */
export interface QuoteDocument {
  number: string;
  /** ISO-Datum */
  issueDate: string;
  validUntil: string;
  serviceFrom?: string;
  serviceTo?: string;
  seller: Seller;
  buyer: Buyer;
  lines: InvoiceDocumentLine[];
  totals: InvoiceTotals;
  note?: string;
  taxTreatment?: TaxTreatment;
  exemptionReason?: string;
  logo?: Logo;
  language?: Language;
}

/** Druckfertige Texte für templates/rechnung.typ */
export function quotePdfData(doc: QuoteDocument) {
  const { seller, buyer } = doc;
  const t = texts(doc.language);
  const meta: { label: string; value: string }[] = [
    { label: t.quoteNumber, value: doc.number },
    { label: t.quoteDate, value: t.date(doc.issueDate) },
    { label: t.validUntil, value: t.date(doc.validUntil) },
  ];
  if (doc.serviceFrom && doc.serviceTo && doc.serviceFrom !== doc.serviceTo) {
    meta.push({ label: t.servicePeriod, value: `${t.date(doc.serviceFrom)} – ${t.date(doc.serviceTo)}` });
  } else if (doc.serviceFrom ?? doc.serviceTo) {
    meta.push({ label: t.serviceDate, value: t.date((doc.serviceFrom ?? doc.serviceTo)!) });
  }
  if (buyer.kundennummer) meta.push({ label: t.customerNumber, value: buyer.kundennummer });

  const treatment = doc.taxTreatment ?? "regulaer";
  const multipleRates = doc.totals.taxes.length > 1;
  const taxRows = (treatment === "regulaer" ? doc.totals.taxes : []).map((tax) => ({
    label: t.vat(t.rate(tax.rate), multipleRates ? t.money(tax.base) : undefined),
    value: t.money(tax.tax),
  }));

  return {
    docTitle: `${t.titles.angebot} ${doc.number}`,
    author: seller.name,
    title: t.titles.angebot,
    labels: templateLabels(t),
    reference: null,
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer, t)],
    meta,
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      description: line.description,
      quantity: t.quantity(line.quantity, line.unit),
      unitPrice: t.money(line.unitPrice),
      rate: treatment === "regulaer" ? t.rate(line.taxRate) : "–",
      net: t.money(line.net),
    })),
    totals: {
      rows: [{ label: t.totalNet, value: t.money(doc.totals.net) }, ...taxRows],
      gross: { label: t.quoteTotal, value: t.money(doc.totals.gross) },
    },
    payment: t.quoteValid(t.date(doc.validUntil)),
    taxNote: t.note(treatment, doc.exemptionReason),
    note: doc.note?.trim() ? doc.note.trim() : null,
    footer: footerColumns(seller, t),
  };
}

/** Angebot als PDF/A-3b mit derselben Vorlage wie die Rechnung */
export function buildQuotePdf(doc: QuoteDocument): Uint8Array {
  return renderQuotePdfData(quotePdfData(doc), doc.issueDate, doc.logo);
}
