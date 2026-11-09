import { planShareLabel, type Discount, type InvoiceTotals, type PriceMode, type QuoteLineKind, type ScheduledRow, type TaxTreatment } from "@haben/core";
import { texts, type Language, type Texts } from "./i18n.ts";
import { asDraft, documentPdfData, draftFilename, renderQuotePdfData, showsCustomerNumber, showsGrossPrices, type DraftPdf } from "./pdf.ts";
import { referenceMeta } from "./format.ts";
import type { Buyer, InvoiceDocumentLine, Letterhead, OrderReferences, Seller } from "./types.ts";

/** Position im Angebot; optionale und alternative zählen nicht zur Summe (help.lexware.de, Artikel 547989) */
export interface QuoteDocumentLine extends InvoiceDocumentLine {
  kind?: QuoteLineKind;
  /** Bei einer Alternative: Position der Hauptposition */
  alternativeTo?: number;
}

/** Angebot: wie eine Rechnung aufgebaut, aber ohne Zahlungsaufforderung und ohne E-Rechnungs-XML */
export interface QuoteDocument extends Letterhead {
  number: string;
  /** ISO-Datum */
  issueDate: string;
  validUntil: string;
  serviceFrom?: string;
  serviceTo?: string;
  seller: Seller;
  buyer: Buyer;
  lines: QuoteDocumentLine[];
  /** Summen der Positionen, die zählen (ohne optionale und alternative) */
  totals: InvoiceTotals;
  /** Gesamtrabatt wie eingegeben */
  discount?: Discount;
  /** Zahlungsplan mit Beträgen; im Angebot immer, in der Auftragsbestätigung nur auf Wunsch */
  paymentPlan?: ScheduledRow[];
  /** Einleitung über den Positionen (Kopftext) */
  intro?: string;
  note?: string;
  taxTreatment?: TaxTreatment;
  exemptionReason?: string;
  /** Fehlt = Nettopreise */
  priceMode?: PriceMode;
  language?: Language;
  /** Bestellnummer des Kunden, eigene Auftragsnummer und Lieferschein; gehen in die Rechnung aus dem Angebot über */
  references?: OrderReferences;
}

/** Leistungszeitraum, Kundennummer und Referenzen; auch für die Auftragsbestätigung */
export function quoteDetails(doc: QuoteDocument, t: Texts): { label: string; value: string }[] {
  const meta: { label: string; value: string }[] = [];
  if (doc.serviceFrom && doc.serviceTo && doc.serviceFrom !== doc.serviceTo) {
    meta.push({ label: t.servicePeriod, value: `${t.date(doc.serviceFrom)} – ${t.date(doc.serviceTo)}` });
  } else if (doc.serviceFrom ?? doc.serviceTo) {
    meta.push({ label: t.serviceDate, value: t.date((doc.serviceFrom ?? doc.serviceTo)!) });
  }
  if (showsCustomerNumber(doc)) meta.push({ label: t.customerNumber, value: doc.buyer.kundennummer! });
  meta.push(...referenceMeta(doc.references, t));
  return meta;
}

/** Zahlungsplan für die Vorlage: je Zeile Bezeichnung, Fälligkeit, Anteil und Betrag; null ohne Plan */
export function planPdfData(doc: QuoteDocument, t: Texts) {
  if (!doc.paymentPlan || doc.paymentPlan.length === 0) return null;
  const taxed = (doc.taxTreatment ?? "regulaer") === "regulaer";
  const netPrices = !showsGrossPrices(doc);
  return {
    title: t.plan.title,
    columns: t.plan.columns,
    rows: doc.paymentPlan.map((row, i) => ({
      label: `${i + 1}. ${row.label}`,
      due: row.due,
      share: planShareLabel(row.share, t.percent, t.money, t.plan.rest),
      amount: taxed && netPrices ? t.plan.netAndGross(t.money(row.net), t.money(row.gross)) : t.money(row.gross),
    })),
  };
}

/** Kennzeichen über der Bezeichnung optionaler und alternativer Positionen */
function lineTags(doc: QuoteDocument, t: Texts) {
  return doc.lines.map((line) =>
    line.kind === "optional" ? t.optionalTag : line.kind === "alternative" ? t.alternativeTag(String(line.alternativeTo ?? "")) : null,
  );
}

/** Druckfertige Texte für templates/rechnung.typ */
export function quotePdfData(doc: QuoteDocument) {
  const t = texts(doc.language);
  // Summen und Gesamtrabatt nur aus den Positionen, die zählen; gezeigt werden alle
  const counted = doc.lines.filter((l) => !l.kind);
  const { totalRows, included, grossLabel, ...body } = documentPdfData({ ...doc, lines: counted }, t);
  const { lines: all, hideVatColumn } = documentPdfData(doc, t);
  const tags = lineTags(doc, t);
  return {
    ...body,
    hideVatColumn,
    lines: all.map((line, i) => (tags[i] ? { ...line, tag: tags[i] } : line)),
    plan: planPdfData(doc, t),
    docTitle: `${t.titles.angebot} ${doc.number}`,
    title: t.titles.angebot,
    reference: null,
    meta: [
      { label: t.quoteNumber, value: doc.number },
      { label: t.quoteDate, value: t.date(doc.issueDate) },
      { label: t.validUntil, value: t.date(doc.validUntil) },
      ...quoteDetails(doc, t),
    ],
    totals: { rows: totalRows, gross: { label: grossLabel(t.quoteTotal), value: t.money(doc.totals.gross) }, included },
    payment: t.quoteValid(t.date(doc.validUntil)),
  };
}

/** Angebot als PDF/A-3b mit derselben Vorlage wie die Rechnung */
export function buildQuotePdf(doc: QuoteDocument): Uint8Array {
  return renderQuotePdfData(quotePdfData(doc), doc.issueDate, doc);
}

/** Angebotsentwurf als PDF mit dem Vermerk „ENTWURF“ über jeder Seite und statt der Nummer */
export function buildQuoteDraftPdf(doc: Omit<QuoteDocument, "number">): DraftPdf {
  const t = texts(doc.language);
  const data = quotePdfData({ ...doc, number: t.draft.mark });
  return { pdf: renderQuotePdfData(asDraft(data, t), doc.issueDate, doc), filename: draftFilename(data.title, doc.issueDate, t) };
}
