import { discountFromColumns, negateDiscount } from "@haben/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { lockInvoice } from "./advance-vat.ts";
import { originalProblem } from "./correction-checks.ts";
import type { LineInput } from "./draft-schema.ts";
import { createDraft, insertDraft, lineInputOf } from "./invoice-drafts.ts";
import { InvoiceError } from "./invoice-error.ts";
import { finalizeDraft } from "./invoice-finalize.ts";
import { getInvoice, type Invoice, type InvoiceLine } from "./invoices.ts";
import { circleFor, lockNumbering } from "./number-counter.ts";
import { referenceColumns } from "./order-references.ts";
import { lockQuotes, quotesTouching } from "./quote-billing.ts";
import { OHNE_UMSATZSTAND } from "./umsatzgrenze.ts";
import { invoiceWrittenOff } from "./zahlungsstand.ts";

/* Storno (sofort festgeschrieben) und Rechnungskorrektur (als Entwurf) einer festgeschriebenen Rechnung */

async function finalOriginal(id: string, q: Db | Tx = db) {
  const data = await getInvoice(id, q);
  if (!data) throw new InvoiceError("Rechnung nicht gefunden.");
  const problem = await originalProblem(data.invoice, q);
  if (problem) throw new InvoiceError(`${problem}.`);
  return data;
}

/**
 * Positionen mit umgekehrtem Vorzeichen; ein fester Positionsrabatt wechselt es mit. Abzüge einer Schlussrechnung bleiben
 * als solche markiert, damit sie wie dort nicht zur Grundlage des Gesamtrabatts zählen (Storno hebt so auf den Cent auf).
 */
function negatedLines(lines: InvoiceLine[]): LineInput[] {
  return lines.map((line) => ({
    ...lineInputOf(line),
    unitPrice: -line.unitPrice,
    discount: negateDiscount(discountFromColumns(line.discountPercent, line.discountAmount)),
    ...(line.deductionOf ? { deductionOf: line.deductionOf } : {}),
  }));
}

/** Gesamtrabatt für Storno und Korrektur: wie in der Rechnung, ein fester Betrag mit umgekehrtem Vorzeichen */
const negatedDiscount = (invoice: Invoice) => negateDiscount(discountFromColumns(invoice.discountPercent, invoice.discountAmount));

/**
 * Stornorechnung mit allen Positionen negativ, sofort festgeschrieben; festgeschriebene Korrekturen der Rechnung
 * bekommen je ein eigenes Storno. Entwurf und Festschreiben in einer Transaktion:
 * Schlägt das Festschreiben fehl oder bricht der Server ab, bleibt kein Storno-Entwurf zurück.
 */
export async function cancelInvoice(actor: string, id: string, today: string): Promise<Invoice> {
  return withActor(actor, async (tx) => {
    // Sperren in derselben Reihenfolge wie beim Festschreiben: Angebote der Rechnung (lockQuotes), Rechnungszeilen, dann
    // Nummernkreis, dann (mit dem ersten Audit-Eintrag) die Hash-Kette. Sonst verklemmen sich ein Storno und eine
    // gleichzeitig festgeschriebene Korrektur derselben Rechnung (die erst das Original, dann den Kreis sperrt).
    await lockQuotes(tx, await quotesTouching(tx, [id]));
    // Original zuerst: Ein zweites Storno wartet hier und sieht danach das erste. Erst mit dem Entwurf (Fremdschlüssel
    // auf das Original) und dann sperren hieße, dass sich zwei gleichzeitige Stornos verklemmen.
    await lockInvoice(tx, id);
    const { invoice, lines } = await finalOriginal(id, tx);
    // Kreis vor dem Entwurf, der schon einen Audit-Eintrag schreibt (number-counter.ts): der Kreis des Originals, beim
    // Kundenkreis also der seines Kunden (#1426). Das PDF entsteht hier nach dem Entwurf, also mit gesperrter Kette;
    // ein Storno ist selten, der eine Entwurf in derselben Transaktion ist wichtiger.
    await lockNumbering(tx, "rechnung", await circleFor(tx, "rechnung", today), invoice.numberContactId);
    // Festgeschriebene Korrekturen haben die Rechnung schon gemindert: jede bekommt ihr eigenes Storno. Je Beleg genau
    // negiert hebt sich auch die Steuer auf den Cent auf, die jeder Beleg für sich rundet. Neue Korrekturen warten auf die
    // Sperre des Originals oben.
    const corrections = await tx
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.correctsId, id), eq(schema.invoices.kind, "korrektur"), eq(schema.invoices.status, "final")))
      .orderBy(asc(schema.invoices.issueDate), asc(schema.invoices.number));
    // Ein Storno nimmt die ganze Rechnung samt Umsatzsteuer zurück; eine Ausbuchung hat einen Teil davon schon gemindert
    // (doppelt bei Soll) und wäre im Storno als Erstattung offen, obwohl kein Geld geflossen ist
    if ((await invoiceWrittenOff([id, ...corrections.map((c) => c.id)], tx)).size > 0) {
      throw new InvoiceError(
        "Die Rechnung ist teilweise ausgebucht (Skonto oder Forderungsausfall). Hebe die Ausbuchung zuerst auf, dann lässt sie sich stornieren.",
      );
    }
    // Ebenso eine Verrechnung mit einer Korrektur (#877): Sie zählt als erledigt, ohne dass Geld geflossen ist, und stünde
    // nach dem Storno als Erstattung an den Kunden und als Forderung aus der Korrektur offen
    const verrechnet = await tx.execute(
      sql`select 1 from invoice_settlements where invoice_id in ${[id, ...corrections.map((c) => c.id)]} group by invoice_id having sum(amount) <> 0 limit 1`,
    );
    if ([...verrechnet].length > 0) {
      throw new InvoiceError("Die Rechnung ist mit einer Korrektur verrechnet. Hebe die Verrechnung zuerst auf, dann lässt sie sich stornieren.");
    }
    const stornoOf = async (target: Invoice, targetLines: InvoiceLine[]) => {
      const draft = await insertDraft(
        tx,
        {
          contactId: target.contactId,
          issueDate: today,
          serviceFrom: target.serviceFrom,
          serviceTo: target.serviceTo,
          paymentTermDays: 0,
          format: target.format,
          note: "",
          propertyRetention: target.propertyRetention,
          // Storno und Korrektur beziehen sich auf dieselbe Bestellung wie die Rechnung (#389)
          ...referenceColumns(target),
          taxTreatment: target.taxTreatment,
          exemptionReason: target.exemptionReason,
          taxDetails: target.taxDetails,
          priceMode: target.priceMode,
          language: target.language,
          lines: negatedLines(targetLines),
          discount: negatedDiscount(target),
        },
        { kind: "storno", correctsId: target.id },
      );
      return finalizeDraft(tx, draft.id, OHNE_UMSATZSTAND);
    };
    const storno = await stornoOf(invoice, lines);
    for (const correction of corrections) {
      const correctionLines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, correction.id))
        .orderBy(asc(schema.invoiceLines.position));
      await stornoOf(correction, correctionLines);
    }
    return storno;
  });
}

/** Rechnungskorrektur als Entwurf: Positionen negativ übernommen, zum Anpassen. */
export async function createCorrection(actor: string, id: string, today: string): Promise<Invoice> {
  const { invoice, lines } = await finalOriginal(id);
  return createDraft(
    actor,
    {
      contactId: invoice.contactId,
      issueDate: today,
      serviceFrom: invoice.serviceFrom,
      serviceTo: invoice.serviceTo,
      paymentTermDays: 0,
      format: invoice.format,
      note: "",
      propertyRetention: invoice.propertyRetention,
      ...referenceColumns(invoice),
      taxTreatment: invoice.taxTreatment,
      exemptionReason: invoice.exemptionReason,
      taxDetails: invoice.taxDetails,
      priceMode: invoice.priceMode,
      language: invoice.language,
      lines: negatedLines(lines),
      discount: negatedDiscount(invoice),
    },
    { kind: "korrektur", correctsId: invoice.id },
  );
}
