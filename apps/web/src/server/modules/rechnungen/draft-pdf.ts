import { buildQuoteDraftPdf, renderInvoiceDraftPdf, type DraftPdf } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { directDebitFor } from "./lastschrift.ts";
import { UserError } from "../../errors.ts";
import { ansprechpartnerSnapshot, loadCompany, loadLetterhead, withCustomLayout } from "../stammdaten/index.ts";
import { invoiceDocumentTotals, invoiceTotalsById } from "./invoice-taxes.ts";
import { buyerFrom, deductedRefs, documentFor, getInvoice, sellerFrom } from "./invoices.ts";
import { getQuote, quoteDocumentFor } from "./quotes.ts";

/*
 * Entwürfe als PDF (Issue #342): aus dem gespeicherten Entwurf mit derselben Vorlage wie beim Festschreiben, mit dem
 * Vermerk „ENTWURF“ über jeder Seite und statt der Nummer. Geschrieben wird nichts: keine Nummer, keine Buchung, kein
 * Versand, kein XML. Was für das Festschreiben noch fehlt, darf fehlen; nur ohne Empfänger gibt es kein Dokument.
 */

export class DraftPdfError extends UserError {}

const NO_CUSTOMER = "Für das Entwurfs-PDF fehlt noch der Kunde.";

/** Entwurf einer Rechnung, Abschlags-, Schluss- oder Korrekturrechnung; null, wenn es keinen Entwurf mit dieser Id gibt */
export async function invoiceDraftPdf(id: string): Promise<DraftPdf | null> {
  const data = await getInvoice(id);
  if (data?.invoice.status !== "draft") return null;
  const { invoice, lines, contact, corrects } = data;
  // Storno und Korrektur gehen an die Anschrift der ursprünglichen Rechnung, wie beim Festschreiben
  const [original] = invoice.correctsId
    ? await db.select({ buyer: schema.invoices.buyer }).from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId))
    : [];
  const buyer = original?.buyer ?? (contact ? buyerFrom(contact, await ansprechpartnerSnapshot(db, invoice.contactPersonId)) : null);
  if (!buyer) throw new DraftPdfError(NO_CUSTOMER);
  const company = await loadCompany();
  // Die Nummer setzt renderInvoiceDraftPdf
  const { number: _none, ...doc } = documentFor(
    invoice,
    lines,
    await invoiceDocumentTotals(id),
    (await invoiceTotalsById([id])).get(id)!,
    sellerFrom(company),
    buyer,
    "",
    corrects?.number ? { number: corrects.number, issueDate: corrects.issueDate } : null,
    await deductedRefs(lines),
    await directDebitFor(invoice, company, db),
  );
  return withCustomLayout("rechnung", await loadLetterhead(), (letterhead) => renderInvoiceDraftPdf({ ...doc, ...letterhead }));
}

/** Entwurf eines Angebots; null, wenn es keinen Entwurf mit dieser Id gibt */
export async function quoteDraftPdf(id: string): Promise<DraftPdf | null> {
  const data = await getQuote(id);
  if (data?.quote.status !== "draft") return null;
  if (!data.contact) throw new DraftPdfError(NO_CUSTOMER);
  const { number: _none, ...doc } = quoteDocumentFor(
    data.quote,
    data.lines,
    sellerFrom(await loadCompany()),
    buyerFrom(data.contact, await ansprechpartnerSnapshot(db, data.quote.contactPersonId)),
    "",
  );
  return withCustomLayout("angebot", await loadLetterhead(), (letterhead) => buildQuoteDraftPdf({ ...doc, ...letterhead }));
}
