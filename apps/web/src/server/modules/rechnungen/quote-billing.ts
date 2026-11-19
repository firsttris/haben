import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { cancelledIds } from "./cancelled-invoices.ts";
import { InvoiceError } from "./invoice-error.ts";

/* Bezug einer Rechnung zum Angebot: Sperren der Angebote und welche Rechnung ein Angebot abrechnet (quotes.invoice_id) */

/** Bezug nur zu einem festgeschriebenen Angebot; ein Entwurf ließe sich sonst nicht mehr löschen */
export async function checkQuote(tx: Tx, quoteId: string | null | undefined) {
  if (!quoteId) return;
  const [quote] = await tx.select({ status: schema.quotes.status }).from(schema.quotes).where(eq(schema.quotes.id, quoteId));
  if (quote?.status !== "final") throw new InvoiceError("Das Angebot ist nicht festgeschrieben.");
}

/**
 * Angebote, deren Abrechnungsstand eine Rechnung berühren kann: ihr Bezug (quote_id) und Angebote, die über
 * quotes.invoice_id auf sie zeigen (auch ältere Rechnungen ohne quote_id), dazu `extra` (neuer Bezug beim Speichern)
 */
export async function quotesTouching(tx: Tx, invoiceIds: (string | null | undefined)[], extra: (string | null | undefined)[] = []): Promise<string[]> {
  const ids = invoiceIds.filter((i): i is string => Boolean(i));
  const linked =
    ids.length === 0
      ? []
      : [
          ...(await tx.select({ id: schema.invoices.quoteId }).from(schema.invoices).where(inArray(schema.invoices.id, ids))).map((r) => r.id),
          ...(await tx.select({ id: schema.quotes.id }).from(schema.quotes).where(inArray(schema.quotes.invoiceId, ids))).map((r) => r.id),
        ];
  return [...new Set([...linked, ...extra].filter((q): q is string => Boolean(q)))].sort();
}

/**
 * Sperrt die Angebote nach id. Feste Reihenfolge überall, wo sich der Abrechnungsstand eines Angebots ändern kann:
 * Angebot, dann Rechnung, dann Nummernkreis, dann (mit dem ersten Audit-Eintrag) die Hash-Kette. quoteToInvoice sperrt das
 * Angebot ebenfalls zuerst. Zwei gleichzeitige Rechnungen zu einem Angebot warten so aufeinander, und die Prüfungen beim
 * Festschreiben sehen die jeweils andere.
 */
export async function lockQuotes(tx: Tx, quoteIds: string[]): Promise<string[]> {
  if (quoteIds.length > 0) {
    await tx.select({ id: schema.quotes.id }).from(schema.quotes).where(inArray(schema.quotes.id, quoteIds)).orderBy(asc(schema.quotes.id)).for("update");
  }
  return quoteIds;
}

/** Nach dem Sperren der Rechnung: Hat sich ihr Bezug seit dem Lesen geändert, wären die falschen Angebote gesperrt */
export async function assertQuotesLocked(tx: Tx, locked: string[], invoiceIds: (string | null | undefined)[], extra: (string | null | undefined)[] = []) {
  if ((await quotesTouching(tx, invoiceIds, extra)).some((q) => !locked.includes(q))) {
    throw new InvoiceError("Die Rechnung wurde gerade an anderer Stelle geändert. Bitte die Seite neu laden.");
  }
}

/** Rechnung über das ganze Angebot: normale Rechnung oder Schlussrechnung, nicht der Abschlag */
export const billsWholeQuote = or(isNull(schema.invoices.variant), eq(schema.invoices.variant, "schluss"));

/**
 * quotes.invoice_id (Angebot abgerechnet) aus den Rechnungen mit Bezug zum Angebot: die nicht stornierte Rechnung über das
 * ganze Angebot, festgeschriebene vor Entwürfen; nach einem Storno ist das Angebot wieder offen. Aufgerufen, wann immer sich Bezug, Rechnungsart oder
 * Status einer solchen Rechnung ändern kann. Ältere festgeschriebene Rechnungen ohne quote_id, die nur über
 * quotes.invoice_id verknüpft sind, bleiben stehen.
 */
export async function syncQuoteBilling(tx: Tx, quoteIds: (string | null | undefined)[]) {
  for (const quoteId of new Set(quoteIds.filter((q): q is string => Boolean(q)))) {
    // Gesperrt ist das Angebot schon (lockQuotes bzw. lockQuote am Anfang der Transaktion)
    const [quote] = await tx.select({ invoiceId: schema.quotes.invoiceId }).from(schema.quotes).where(eq(schema.quotes.id, quoteId));
    if (!quote) continue;
    if (quote.invoiceId) {
      const [current] = await tx
        .select({
          quoteId: schema.invoices.quoteId,
          lockedAt: schema.invoices.lockedAt,
          cancelled: sql<boolean>`${schema.invoices.id} in (${cancelledIds})`,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, quote.invoiceId));
      // Ältere Rechnung ohne quote_id rechnet das Angebot ab, solange sie nicht storniert ist
      if (current && current.quoteId === null && current.lockedAt && !current.cancelled) continue;
    }
    const [billing] = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(
        and(eq(schema.invoices.quoteId, quoteId), eq(schema.invoices.kind, "rechnung"), billsWholeQuote, sql`${schema.invoices.id} not in (${cancelledIds})`),
      )
      .orderBy(sql`${schema.invoices.status} <> 'final'`, desc(schema.invoices.createdAt))
      .limit(1);
    const invoiceId = billing?.id ?? null;
    if (invoiceId !== quote.invoiceId) {
      await tx.update(schema.quotes).set({ invoiceId, updatedAt: new Date() }).where(eq(schema.quotes.id, quoteId));
    }
  }
}
