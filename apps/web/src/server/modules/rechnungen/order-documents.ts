import { UserError } from "../../errors.ts";
import { buildConfirmationPdf, buildDeliveryNotePdf, type Buyer, type OrderReferences, type Seller } from "@haben/einvoice";
import type { UnitLabel } from "@haben/core";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadCompany, loadLetterhead, standardTexte, withCustomLayout } from "../stammdaten/index.ts";
import { withCurrentBuyer, withCurrentSeller } from "./invoice-document.ts";
import { quoteChoices } from "./quote-choices.ts";
import { documentReferences, type ReferenceColumns } from "./order-references.ts";
import { orderLines, quoteDocumentFor } from "./quotes.ts";
import { today } from "../../today.ts";
import { angebotMitPlatzhaltern, mitVorlage } from "./beleg-platzhalter.ts";

/**
 * Auftragsbestätigung und Lieferschein entstehen auf Abruf aus festgeschriebenen Angeboten und
 * Rechnungen. Sie buchen nichts; Inhalt und Datum folgen aus dem gespeicherten Beleg.
 */

export class OrderDocumentError extends UserError {}

async function acceptedQuote(id: string) {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  if (quote?.status !== "final" || !quote.number || !quote.seller || !quote.buyer) {
    throw new OrderDocumentError("Nur festgeschriebene Angebote haben Auftragsbestätigung und Lieferschein.");
  }
  if (quote.decision !== "angenommen" || !quote.decidedAt) throw new OrderDocumentError("Das Angebot ist nicht als angenommen markiert.");
  const lines = await db.select().from(schema.quoteLines).where(eq(schema.quoteLines.quoteId, id)).orderBy(asc(schema.quoteLines.position));
  const choices = await quoteChoices(id);
  return { quote: { ...quote, number: quote.number, seller: quote.seller, buyer: quote.buyer, decidedAt: quote.decidedAt }, lines, choices };
}

/**
 * Auftragsbestätigung zum angenommenen Angebot, datiert auf die Annahme: nur die Positionen nach der Auswahl des Kunden,
 * auf Wunsch mit dem Zahlungsplan
 */
export async function confirmationPdf(quoteId: string) {
  const { quote, lines, choices } = await acceptedQuote(quoteId);
  const buyer = await withCurrentBuyer(db, quote.buyer, quote.contactId);
  // Ohne Entwurf greift der Standard beim Erzeugen (#1494): er ersetzt Einleitung bzw. Hinweis des Angebots
  const standard = await standardTexte("auftragsbestaetigung");
  const texte = mitVorlage(quote);
  const mitStandard = { intro: standard.kopf || texte.intro, note: standard.fuss || texte.note };
  // Platzhalter mit den Werten der Bestätigung (gewählte Positionen), nicht mit denen des Angebots (#1334)
  const doc = angebotMitPlatzhaltern(
    quoteDocumentFor({ ...quote, ...mitStandard }, lines, withCurrentSeller(quote.seller, await loadCompany()), buyer, quote.number, {
      choices,
      withPlan: quote.paymentPlanInConfirmation,
    }),
  );
  const pdf = await withCustomLayout("auftragsbestaetigung", await loadLetterhead(), (letterhead) =>
    buildConfirmationPdf({ ...doc, ...letterhead }, today(quote.decidedAt)),
  );
  return { pdf, filename: `${quote.language === "en" ? "Order-confirmation" : "Auftragsbestaetigung"}-${quote.number}.pdf` };
}

interface DeliverySource {
  number: string;
  issueDate: string;
  date: string;
  deliveryDate: string;
  seller: Seller;
  buyer: Buyer;
  contactId: string | null;
  language: "de" | "en";
  lines: { description: string; detail: string; itemNumber: string; quantity: number; unit: string }[];
  /** Bestellnummer des Kunden und eigene Auftragsnummer; die Lieferscheinnummer nennt der Lieferschein nicht noch einmal */
  references: OrderReferences;
}

async function deliverySource(source: "angebot" | "rechnung", id: string): Promise<DeliverySource> {
  if (source === "angebot") {
    const { quote, lines, choices } = await acceptedQuote(id);
    const date = today(quote.decidedAt);
    return {
      number: quote.number,
      issueDate: quote.issueDate,
      date,
      deliveryDate: quote.serviceTo ?? quote.serviceFrom ?? date,
      seller: quote.seller,
      buyer: quote.buyer,
      contactId: quote.contactId,
      language: quote.language,
      lines: orderLines(lines, choices),
      references: orderReferencesOf(quote),
    };
  }
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (invoice?.status !== "final" || invoice.kind !== "rechnung" || !invoice.number || !invoice.seller || !invoice.buyer) {
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
    contactId: invoice.contactId,
    language: invoice.language,
    // Abzüge einer Schlussrechnung sind keine Lieferung
    lines: lines.filter((l) => !l.deductionOf),
    references: orderReferencesOf(invoice),
  };
}

function orderReferencesOf(row: ReferenceColumns): OrderReferences {
  const { despatchAdvice: _despatchAdvice, ...references } = documentReferences(row).references ?? {};
  return references;
}

/** Lieferschein zu einem angenommenen Angebot oder einer festgeschriebenen Rechnung */
export async function deliveryNotePdf(source: "angebot" | "rechnung", id: string) {
  const base = await deliverySource(source, id);
  const seller = withCurrentSeller(base.seller, await loadCompany());
  const buyer = await withCurrentBuyer(db, base.buyer, base.contactId);
  // Der Lieferschein hat keinen Entwurf: Ein Standard-Fußtext steht beim Erzeugen als Hinweis darauf (#1494)
  const { fuss } = await standardTexte("lieferschein");
  const pdf = await withCustomLayout("lieferschein", await loadLetterhead(), (letterhead) =>
    buildDeliveryNotePdf({
      reference: { kind: source, number: base.number, issueDate: base.issueDate },
      deliveryDate: base.deliveryDate,
      date: base.date,
      seller,
      buyer,
      language: base.language,
      references: base.references,
      ...(fuss ? { note: fuss } : {}),
      lines: base.lines.map((l, i) => ({
        position: i + 1,
        description: l.description,
        ...(l.detail ? { detail: l.detail } : {}),
        ...(l.itemNumber ? { itemNumber: l.itemNumber } : {}),
        quantity: l.quantity,
        unit: l.unit as UnitLabel,
      })),
      ...letterhead,
    }),
  );
  return { pdf, filename: `${base.language === "en" ? "Delivery-note" : "Lieferschein"}-${base.number}.pdf` };
}
