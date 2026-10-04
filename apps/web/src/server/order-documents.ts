import { buildConfirmationPdf, buildDeliveryNotePdf, type Buyer, type Seller } from "@haben/einvoice";
import type { UnitLabel } from "@haben/core";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "./db/index.ts";
import { loadLogo } from "./logo.ts";
import { quoteDocumentFor } from "./quotes.ts";
import { today } from "./today.ts";

/**
 * Auftragsbestätigung und Lieferschein entstehen auf Abruf aus festgeschriebenen Angeboten und
 * Rechnungen. Sie buchen nichts; Inhalt und Datum folgen aus dem gespeicherten Beleg.
 */

export class OrderDocumentError extends Error {}

async function acceptedQuote(id: string) {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  if (!quote || quote.status !== "final" || !quote.number || !quote.seller || !quote.buyer) {
    throw new OrderDocumentError("Nur festgeschriebene Angebote haben Auftragsbestätigung und Lieferschein.");
  }
  if (quote.decision !== "angenommen" || !quote.decidedAt) throw new OrderDocumentError("Das Angebot ist nicht als angenommen markiert.");
  const lines = await db.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id)).orderBy(asc(schema.quoteLines.position));
  return { quote: { ...quote, number: quote.number, seller: quote.seller, buyer: quote.buyer, decidedAt: quote.decidedAt }, lines };
}

/** Auftragsbestätigung zum angenommenen Angebot, datiert auf die Annahme */
export async function confirmationPdf(quoteId: string) {
  const { quote, lines } = await acceptedQuote(quoteId);
  const doc = quoteDocumentFor(quote, lines, quote.seller, quote.buyer, quote.number);
  const logo = await loadLogo();
  const pdf = buildConfirmationPdf(logo ? { ...doc, logo } : doc, today(quote.decidedAt));
  return { pdf, filename: `${quote.language === "en" ? "Order-confirmation" : "Auftragsbestaetigung"}-${quote.number}.pdf` };
}

interface DeliverySource {
  number: string;
  issueDate: string;
  date: string;
  deliveryDate: string;
  seller: Seller;
  buyer: Buyer;
  language: "de" | "en";
  lines: { description: string; quantity: number; unit: string }[];
}

async function deliverySource(source: "angebot" | "rechnung", id: string): Promise<DeliverySource> {
  if (source === "angebot") {
    const { quote, lines } = await acceptedQuote(id);
    const date = today(quote.decidedAt);
    return {
      number: quote.number,
      issueDate: quote.issueDate,
      date,
      deliveryDate: quote.serviceTo ?? quote.serviceFrom ?? date,
      seller: quote.seller,
      buyer: quote.buyer,
      language: quote.language,
      lines,
    };
  }
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!invoice || invoice.status !== "final" || invoice.kind !== "rechnung" || !invoice.number || !invoice.seller || !invoice.buyer) {
    throw new OrderDocumentError("Lieferscheine gibt es nur zu festgeschriebenen Rechnungen.");
  }
  const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).orderBy(asc(schema.invoiceLines.position));
  return {
    number: invoice.number,
    issueDate: invoice.issueDate,
    date: invoice.issueDate,
    deliveryDate: invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate,
    seller: invoice.seller,
    buyer: invoice.buyer,
    language: invoice.language,
    // Abzüge einer Schlussrechnung sind keine Lieferung
    lines: lines.filter((l) => !l.deductionOf),
  };
}

/** Lieferschein zu einem angenommenen Angebot oder einer festgeschriebenen Rechnung */
export async function deliveryNotePdf(source: "angebot" | "rechnung", id: string) {
  const base = await deliverySource(source, id);
  const logo = await loadLogo();
  const pdf = buildDeliveryNotePdf({
    reference: { kind: source, number: base.number, issueDate: base.issueDate },
    deliveryDate: base.deliveryDate,
    date: base.date,
    seller: base.seller,
    buyer: base.buyer,
    language: base.language,
    lines: base.lines.map((l, i) => ({ position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit as UnitLabel })),
    ...(logo ? { logo } : {}),
  });
  return { pdf, filename: `${base.language === "en" ? "Delivery-note" : "Lieferschein"}-${base.number}.pdf` };
}
