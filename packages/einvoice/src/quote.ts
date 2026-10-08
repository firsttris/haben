import type { InvoiceTotals, TaxTreatment } from "@haben/core";
import { texts, type Language, type Texts } from "./i18n.ts";
import { documentPdfData, renderQuotePdfData } from "./pdf.ts";
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

/** Leistungszeitraum und Kundennummer; auch für die Auftragsbestätigung */
export function quoteDetails(doc: QuoteDocument, t: Texts): { label: string; value: string }[] {
  const meta: { label: string; value: string }[] = [];
  if (doc.serviceFrom && doc.serviceTo && doc.serviceFrom !== doc.serviceTo) {
    meta.push({ label: t.servicePeriod, value: `${t.date(doc.serviceFrom)} – ${t.date(doc.serviceTo)}` });
  } else if (doc.serviceFrom ?? doc.serviceTo) {
    meta.push({ label: t.serviceDate, value: t.date((doc.serviceFrom ?? doc.serviceTo)!) });
  }
  if (doc.buyer.kundennummer) meta.push({ label: t.customerNumber, value: doc.buyer.kundennummer });
  return meta;
}

/** Druckfertige Texte für templates/rechnung.typ */
export function quotePdfData(doc: QuoteDocument) {
  const t = texts(doc.language);
  const { totalRows, ...body } = documentPdfData(doc, t);
  return {
    ...body,
    docTitle: `${t.titles.angebot} ${doc.number}`,
    title: t.titles.angebot,
    reference: null,
    meta: [
      { label: t.quoteNumber, value: doc.number },
      { label: t.quoteDate, value: t.date(doc.issueDate) },
      { label: t.validUntil, value: t.date(doc.validUntil) },
      ...quoteDetails(doc, t),
    ],
    totals: { rows: totalRows, gross: { label: t.quoteTotal, value: t.money(doc.totals.gross) } },
    payment: t.quoteValid(t.date(doc.validUntil)),
  };
}

/** Angebot als PDF/A-3b mit derselben Vorlage wie die Rechnung */
export function buildQuotePdf(doc: QuoteDocument): Uint8Array {
  return renderQuotePdfData(quotePdfData(doc), doc.issueDate, doc.logo);
}
