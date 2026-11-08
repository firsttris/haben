import { texts, type Language } from "./i18n.ts";
import { addressLines, footerData, itemNumberColumn, renderQuotePdfData, showsCustomerNumber, showsGrossPrices, templateLabels } from "./pdf.ts";
import { quoteDetails, quotePdfData, type QuoteDocument } from "./quote.ts";
import { referenceMeta } from "./format.ts";
import type { Buyer, InvoiceDocumentLine, Letterhead, OrderReferences, Seller } from "./types.ts";

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
    meta: [{ label: t.date_, value: t.date(date) }, { label: t.quoteRef, value: `${doc.number} (${t.date(doc.issueDate)})` }, ...quoteDetails(doc, t)],
    totals: { ...base.totals, gross: { ...base.totals.gross, label: showsGrossPrices(doc) ? t.inclVat(t.orderTotal) : t.orderTotal } },
    payment: t.confirmationText,
  };
}

export function buildConfirmationPdf(doc: QuoteDocument, date: string): Uint8Array {
  return renderQuotePdfData(confirmationPdfData(doc, date), date, doc);
}

export interface DeliveryNoteDocument extends Letterhead {
  /** Angebot oder Rechnung, auf die sich der Lieferschein bezieht */
  reference: { kind: "angebot" | "rechnung"; number: string; issueDate: string };
  /** ISO-Datum der Lieferung bzw. Leistung */
  deliveryDate: string;
  /** ISO-Datum des Lieferscheins */
  date: string;
  seller: Seller;
  buyer: Buyer;
  lines: Pick<InvoiceDocumentLine, "position" | "itemNumber" | "description" | "detail" | "quantity" | "unit">[];
  note?: string;
  language?: Language;
  /** Bestellnummer des Kunden und eigene Auftragsnummer aus Rechnung bzw. Angebot */
  references?: OrderReferences;
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
  if (showsCustomerNumber(doc)) meta.push({ label: t.customerNumber, value: buyer.kundennummer! });
  meta.push(...referenceMeta(doc.references, t));
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
    ...itemNumberColumn(doc.lines),
    lines: doc.lines.map((line) => ({
      pos: String(line.position),
      itemNumber: line.itemNumber?.trim() ?? "",
      description: line.description,
      // Wie auf Rechnung und Angebot: der Text unter der Bezeichnung beschreibt, was geliefert wird
      detail: line.detail?.trim() ? line.detail.trim() : null,
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
    ...footerData(seller, t, doc.options),
  };
}

export function buildDeliveryNotePdf(doc: DeliveryNoteDocument): Uint8Array {
  return renderQuotePdfData(deliveryNotePdfData(doc), doc.date, doc);
}
