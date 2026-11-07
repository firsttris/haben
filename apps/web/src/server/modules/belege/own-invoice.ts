import { detectOwnInvoice, ownInvoiceHint, type Cents, type OwnInvoiceInput, type OwnInvoiceVerdict, type StatedParties, type TextLine } from "@haben/core";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { invoiceTotalsById } from "../rechnungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { ownCompanyOf } from "./own-invoice-facts.ts";

/*
 * Erkennung eigener Ausgangsrechnungen beim Beleg-Upload (Roadmap S4, #104): sammelt, was über den Beleg bekannt ist
 * (Parteien aus E-Rechnung oder KI, Textebene des PDFs, passende Rechnung in Haben), und fragt die Regeln in
 * @haben/core. Erkannt wird nur ein Hinweis; gebucht oder verworfen wird nichts.
 */

/** Festgeschriebene Ausgangsrechnung mit dieser Nummer und diesem Bruttobetrag (Euro), sonst null */
export async function knownInvoiceNumber(invoiceNumber: string, gross: Cents): Promise<string | null> {
  const number = invoiceNumber.trim();
  if (!number) return null;
  const [invoice] = await db
    .select({ id: schema.invoices.id, number: schema.invoices.number })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.number, number), eq(schema.invoices.status, "final")));
  if (!invoice) return null;
  const totals = (await invoiceTotalsById([invoice.id])).get(invoice.id);
  return totals?.gross === gross ? invoice.number : null;
}

export interface OwnInvoiceFacts {
  parties?: StatedParties;
  lines?: TextLine[] | null;
  invoiceNumber?: string;
  gross?: Cents;
}

export async function detectOwnInvoiceFor(facts: OwnInvoiceFacts): Promise<OwnInvoiceVerdict> {
  const company = ownCompanyOf(await loadCompany());
  const input: OwnInvoiceInput = {
    parties: facts.parties,
    lines: facts.lines ?? undefined,
    knownInvoiceNumber: facts.invoiceNumber && facts.gross !== undefined ? await knownInvoiceNumber(facts.invoiceNumber, facts.gross) : null,
  };
  return detectOwnInvoice(input, company);
}

/** Was am Beleg gespeichert wird (Spalte extraction), damit sich der Hinweis später nachvollziehen lässt */
export function ownInvoiceRecord(verdict: OwnInvoiceVerdict) {
  return {
    stufe: verdict.level,
    konfidenz: Math.round(verdict.confidence * 100) / 100,
    signale: verdict.signals.map((s) => ({ regel: s.rule, richtung: s.direction, konfidenz: s.confidence, grund: s.reason })),
  };
}

export { ownInvoiceHint };
export { partiesOfEInvoice, partiesOfExtraction } from "./own-invoice-facts.ts";
