import { texts, type Language } from "./i18n.ts";
import { addressLines, footerColumns, renderQuotePdfData, templateLabels } from "./pdf.ts";
import { quoteDetails, quotePdfData, type QuoteDocument } from "./quote.ts";
import type { Buyer, InvoiceDocumentLine, Logo, Seller } from "./types.ts";

/**
 * Auftragsbestätigung und Lieferschein: Begleitdokumente ohne Buchung und ohne E-Rechnung,
 * gesetzt mit derselben Vorlage wie Rechnung und Angebot.
 */

/** Auftragsbestätigung zum angenommenen Angebot: gleiche Positionen und Preise, Dank statt Gültigkeit */
export function confirmationPdfData(doc: QuoteDocument, date: string) {
  const t = texts(doc.language);
  const base = quotePdfData(doc);
  return {
    ...base,
    docTitle: `${t.confirmation} ${doc.number}`,
    title: t.confirmation,
    // Angebotsnummer, -datum und Gültigkeit ersetzt der Bezug aufs Angebot
    meta: [
      { label: t.date_, value: t.date(date) },
      { label: t.quoteRef, value: `${doc.number} (${t.date(doc.issueDate)})` },
      ...quoteDetails(doc, t),
    ],
    totals: { ...base.totals, gross: { ...base.totals.gross, label: t.orderTotal } },
    payment: t.confirmationText,
  };
}

export function buildConfirmationPdf(doc: QuoteDocument, date: string): Uint8Array {
  return renderQuotePdfData(confirmationPdfData(doc, date), date, doc.logo);
}

export interface DeliveryNoteDocument {
  /** Angebot oder Rechnung, auf die sich der Lieferschein bezieht */
  reference: { kind: "angebot" | "rechnung"; number: string; issueDate: string };
  /** ISO-Datum der Lieferung bzw. Leistung */
  deliveryDate: string;
  /** ISO-Datum des Lieferscheins */
  date: string;
  seller: Seller;
  buyer: Buyer;
  lines: Pick<InvoiceDocumentLine, "position" | "description" | "quantity" | "unit">[];
  note?: string;
  logo?: Logo;
  language?: Language;
}

/** Lieferschein: Positionen mit Menge, ohne Preise, mit Feld für die Empfangsbestätigung */
export function deliveryNotePdfData(doc: DeliveryNoteDocument) {
  const { seller, buyer } = doc;
  const t = texts(doc.language);
  const meta: { label: string; value: string }[] = [
    { label: t.date_, value: t.date(doc.date) },
    { label: t.deliveryDate, value: t.date(doc.deliveryDate) },
    { label: doc.reference.kind === "angebot" ? t.quoteRef : t.invoiceRef, value: `${doc.reference.number} (${t.date(doc.reference.issueDate)})` },
  ];
  if (buyer.kundennummer) meta.push({ label: t.customerNumber, value: buyer.kundennummer });
  return {
    docTitle: `${t.deliveryNote} ${doc.reference.number}`,
    author: seller.name,
    title: t.deliveryNote,
    labels: templateLabels(t),
    reference: null,
    senderLine: [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`].join(" · "),
    recipient: [buyer.name, ...addressLines(buyer, t)],
    meta,
    noPrices: true,
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      description: line.description,
      quantity: t.quantity(line.quantity, line.unit),
      unitPrice: "",
      rate: "",
      net: "",
    })),
    totals: null,
    payment: null,
    signature: { text: t.received, label: t.signature },
    qr: null,
    taxNote: null,
    note: doc.note?.trim() ? doc.note.trim() : null,
    footer: footerColumns(seller, t),
  };
}

export function buildDeliveryNotePdf(doc: DeliveryNoteDocument): Uint8Array {
  return renderQuotePdfData(deliveryNotePdfData(doc), doc.date, doc.logo);
}
