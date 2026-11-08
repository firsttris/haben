import { discountFromColumns, formatExchangeRate, type UnitLabel } from "@haben/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { insertDraft, type DraftInput, type Invoice, type InvoiceLine } from "./invoices.ts";

/*
 * Externe Referenz eines Rechnungsentwurfs (#199): Plattform und Bestellnummer eines Vorgangs außerhalb von Haben, etwa
 * einer Etsy-Bestellung, aus der ein eigenes Werkzeug über die REST-API einen Entwurf anlegt. Dieselbe Referenz legt
 * keinen zweiten Entwurf an, sondern liefert den vorhandenen; so darf ein Workflow eine Bestellung gefahrlos erneut
 * schicken. Der eindeutige Index invoices_external_ref sichert das auch bei gleichzeitigen Anfragen.
 */

export const externalReferenceSchema = z.object({
  /** Plattform in Kleinbuchstaben, z. B. etsy, ebay, shopify */
  externalSource: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "Plattform in Kleinbuchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich, z. B. etsy"),
  /** Bestell- oder Vorgangsnummer auf der Plattform */
  externalId: z
    .string()
    .trim()
    .min(1, "Bestellnummer fehlt")
    .max(100)
    .regex(/^[^\p{Cc}]+$/u, "Bestellnummer ohne Steuerzeichen"),
});

export type ExternalReference = z.infer<typeof externalReferenceSchema>;

export async function findInvoiceByReference(reference: ExternalReference): Promise<Invoice | null> {
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.externalSource, reference.externalSource), eq(schema.invoices.externalId, reference.externalId)));
  return invoice ?? null;
}

/**
 * Legt einen Entwurf mit externer Referenz an, oder liefert die Rechnung, die schon diese Referenz trägt (Entwurf oder
 * festgeschrieben, unverändert). `created` sagt, welcher Fall eingetreten ist.
 */
export async function createDraftForReference(actor: string, input: DraftInput, reference: ExternalReference): Promise<{ invoice: Invoice; created: boolean }> {
  const existing = await findInvoiceByReference(reference);
  if (existing) return { invoice: existing, created: false };
  try {
    return { invoice: await withActor(actor, (tx) => insertDraft(tx, input, reference)), created: true };
  } catch (error) {
    // Gleichzeitig angelegt: die andere Anfrage hat gewonnen, ihr Entwurf gilt
    if (!isUniqueViolation(error, "invoices_external_ref")) throw error;
    const winner = await findInvoiceByReference(reference);
    if (!winner) throw error;
    return { invoice: winner, created: false };
  }
}

/**
 * Eingabe des Editors aus einem gespeicherten Entwurf, wie die Seite /rechnungen/$id sie aufbaut: eigene Positionen ohne
 * die Abzüge einer Schlussrechnung, ein übernommener USt-Kurs bleibt leer und folgt dem Leistungsmonat.
 */
export function draftInputOf(invoice: Invoice, lines: InvoiceLine[]): DraftInput {
  return {
    contactId: invoice.contactId,
    issueDate: invoice.issueDate,
    serviceFrom: invoice.serviceFrom,
    serviceTo: invoice.serviceTo,
    paymentTermDays: invoice.paymentTermDays,
    skonto: invoice.skonto,
    format: invoice.format,
    intro: invoice.intro,
    note: invoice.note,
    buyerOrderReference: invoice.buyerOrderReference,
    sellerOrderReference: invoice.sellerOrderReference,
    despatchAdviceReference: invoice.despatchAdviceReference,
    taxTreatment: invoice.taxTreatment,
    exemptionReason: invoice.exemptionReason,
    priceMode: invoice.priceMode,
    language: invoice.language,
    variant: invoice.variant,
    quoteId: invoice.quoteId,
    deducts: [...new Set(lines.flatMap((line) => (line.deductionOf ? [line.deductionOf] : [])))],
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate && invoice.exchangeRateSource !== "ust" ? formatExchangeRate(invoice.exchangeRate) : null,
    exchangeRateDate: invoice.exchangeRateSource === "ust" ? null : invoice.exchangeRateDate,
    // Rabatte bleiben, wenn die API nur andere Felder ändert; die API selbst setzt keine
    discount: discountFromColumns(invoice.discountPercent, invoice.discountAmount),
    lines: lines
      .filter((line) => !line.deductionOf)
      .map((line) => ({
        description: line.description,
        detail: line.detail,
        itemNumber: line.itemNumber,
        quantity: line.quantity,
        unit: line.unit as UnitLabel,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate as 1900 | 700 | 0,
        discount: discountFromColumns(line.discountPercent, line.discountAmount),
      })),
  };
}
