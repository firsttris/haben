import { withActor } from "../../db/actor.ts";
import { contactPersonProblem } from "../stammdaten/index.ts";
import { draftInputOf } from "./external-reference.ts";
import { InvoiceError } from "./invoice-error.ts";
import { assertCustomer, draftSchema, getInvoice, insertDraft, type Invoice } from "./invoices.ts";

/** Warum sich eine Rechnung nicht kopieren lässt; null = sie lässt sich kopieren */
function copyProblem(invoice: Pick<Invoice, "kind" | "variant" | "status">): string | null {
  if (invoice.kind !== "rechnung") return "Stornorechnungen und Korrekturen lassen sich nicht kopieren.";
  if (invoice.variant !== null) return "Abschlags- und Schlussrechnungen lassen sich nicht kopieren; sie entstehen aus dem Angebot.";
  if (invoice.status !== "final") return "Nur festgeschriebene Rechnungen lassen sich kopieren.";
  return null;
}

/**
 * Neuer Entwurf aus einer festgeschriebenen Rechnung für die nächste ähnliche (docs/rechnungen.md, Festgeschriebene Rechnung).
 * Datum heute; Leistungszeitraum und Kurs leer, der Kurs folgt dem neuen Leistungsmonat. Anhänge gehören zur einzelnen
 * Rechnung und bleiben beim Original, ebenso der Bezug zu einem Angebot.
 */
export async function copyInvoice(actor: string, id: string, today: string): Promise<Invoice> {
  const data = await getInvoice(id);
  if (!data) throw new InvoiceError("Rechnung nicht gefunden.");
  const { invoice, lines } = data;
  const problem = copyProblem(invoice);
  if (problem) throw new InvoiceError(problem);
  const paid = invoice.paymentMethod === "bereits_bezahlt";
  return withActor(actor, async (tx) => {
    await assertCustomer(tx, invoice.contactId);
    const personActive = (await contactPersonProblem(tx, invoice.contactId, invoice.contactPersonId)) === null;
    const input = draftSchema.parse({
      ...draftInputOf(invoice, lines),
      contactPersonId: personActive ? invoice.contactPersonId : null,
      issueDate: today,
      serviceFrom: null,
      serviceTo: null,
      exchangeRate: null,
      exchangeRateDate: null,
      paymentMethod: paid ? "ueberweisung" : invoice.paymentMethod,
      paidVia: null,
      paidOn: null,
      // Eine Rechnung aus einem Angebot rechnet das Angebot ab; die Kopie ist eine eigene Rechnung ohne Bezug
      quoteId: null,
      advanceType: null,
      deducts: [],
    });
    return insertDraft(tx, input);
  });
}
