import { formatEuro, formatQuantity, formatRate, treatmentNote, type InvoiceTotals, type TaxTreatment } from "@haben/core";
import { formatDate } from "./format.ts";
import { addressLines, footerColumns, renderQuotePdfData } from "./pdf.ts";
import type { Buyer, InvoiceDocumentLine, Seller } from "./types.ts";

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
}

/** Druckfertige Texte für templates/rechnung.typ */
export function quotePdfData(doc: QuoteDocument) {
  const { seller, buyer } = doc;
  const meta = [
    { label: "Angebotsnummer", value: doc.number },
    { label: "Angebotsdatum", value: formatDate(doc.issueDate) },
    { label: "Gültig bis", value: formatDate(doc.validUntil) },
  ];
  if (doc.serviceFrom && doc.serviceTo && doc.serviceFrom !== doc.serviceTo) {
    meta.push({ label: "Leistungszeitraum", value: `${formatDate(doc.serviceFrom)} – ${formatDate(doc.serviceTo)}` });
  } else if (doc.serviceFrom ?? doc.serviceTo) {
    meta.push({ label: "Leistungsdatum", value: formatDate((doc.serviceFrom ?? doc.serviceTo)!) });
  }
  if (buyer.kundennummer) meta.push({ label: "Kundennummer", value: buyer.kundennummer });

  const treatment = doc.taxTreatment ?? "regulaer";
  const multipleRates = doc.totals.taxes.length > 1;
  const taxRows = (treatment === "regulaer" ? doc.totals.taxes : []).map((t) => ({
    label: multipleRates ? `Umsatzsteuer ${formatRate(t.rate)} auf ${formatEuro(t.base)}` : `Umsatzsteuer ${formatRate(t.rate)}`,
    value: formatEuro(t.tax),
  }));

  return {
    docTitle: `Angebot ${doc.number}`,
    author: seller.name,
    title: "Angebot",
    reference: null,
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer)],
    meta,
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      description: line.description,
      quantity: `${formatQuantity(line.quantity)} ${line.unit}`,
      unitPrice: formatEuro(line.unitPrice),
      rate: treatment === "regulaer" ? formatRate(line.taxRate) : "–",
      net: formatEuro(line.net),
    })),
    totals: {
      rows: [{ label: "Summe netto", value: formatEuro(doc.totals.net) }, ...taxRows],
      gross: { label: "Angebotssumme", value: formatEuro(doc.totals.gross) },
    },
    payment: `Dieses Angebot gilt bis zum ${formatDate(doc.validUntil)}. Wir freuen uns auf Ihren Auftrag.`,
    taxNote: treatmentNote(treatment, doc.exemptionReason),
    note: doc.note?.trim() ? doc.note.trim() : null,
    footer: footerColumns(seller),
  };
}

/** Angebot als PDF/A-3b mit derselben Vorlage wie die Rechnung */
export function buildQuotePdf(doc: QuoteDocument): Uint8Array {
  return renderQuotePdfData(quotePdfData(doc), doc.issueDate);
}
