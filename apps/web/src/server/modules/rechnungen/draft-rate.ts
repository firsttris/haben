import { CURRENCY_CODE, parseExchangeRate, totalsFromTaxes } from "@haben/core";
import { and, eq, ne, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { loadCompany, NO_RATE, resolveExchangeRate, type RateFields } from "../stammdaten/index.ts";
import { lockInvoice } from "./advance-vat.ts";
import type { DraftInput } from "./draft-schema.ts";
import { InvoiceError } from "./invoice-error.ts";
import { euroTaxes, storeInvoiceTaxes } from "./invoice-taxes.ts";
import type { Invoice } from "./invoices.ts";

/* Währung und Umrechnungskurs von Rechnungsentwürfen */

/** Höchstwert der int4-Spalten für Euro-Beträge: ein sehr kleiner Kurs darf sie nicht sprengen */
export const MAX_EURO_CENTS = 2_147_483_647;

/** Monat der Leistung für den Umrechnungskurs: Ende des Leistungszeitraums, sonst das Rechnungsdatum */
export const serviceDate = (input: { issueDate: string; serviceFrom?: string | null; serviceTo?: string | null }) =>
  input.serviceTo ?? input.serviceFrom ?? input.issueDate;

/**
 * Kurs eines Entwurfs: Storno und Korrektur übernehmen Währung und Kurs der ursprünglichen Rechnung (dieselben Euro-Beträge
 * mit umgekehrtem Vorzeichen), sonst wie bei Belegen (resolveExchangeRate) für den Monat der Leistung.
 */
export async function draftRate(tx: Tx, input: DraftInput, correctsId: string | null, previous: Invoice | null): Promise<{ currency: string } & RateFields> {
  if (correctsId) {
    const [original] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, correctsId));
    if (original) {
      return {
        currency: original.currency,
        exchangeRate: original.exchangeRate ? parseExchangeRate(original.exchangeRate) : null,
        exchangeRateSource: original.exchangeRateSource,
        exchangeRateDate: original.exchangeRateDate,
      };
    }
  }
  // Die Server Functions prüfen das Eingabeschema schon; hier nur die Felder der Währung, in der Form des Schemas
  const currency = (input.currency ?? "EUR").trim().toUpperCase();
  if (currency === "EUR") return { currency, ...NO_RATE };
  if (!CURRENCY_CODE.test(currency)) throw new InvoiceError("Währung als dreistelliger Code, z. B. USD.");
  const exchangeRate = input.exchangeRate?.trim() ? parseExchangeRate(input.exchangeRate) : null;
  if (input.exchangeRate?.trim() && !exchangeRate) throw new InvoiceError("Umrechnungskurs ungültig, z. B. 1,0812.");
  const { tageskurs } = await loadCompany(tx);
  const rate = await resolveExchangeRate(
    tx,
    { currency, date: serviceDate(input), exchangeRate, exchangeRateDate: input.exchangeRateDate ?? null },
    previous && previous.currency === currency ? previous : null,
    tageskurs,
  );
  return { currency, ...rate };
}

/**
 * Entwurf in Fremdwährung ohne Kurs, dessen USt-Umrechnungskurs inzwischen veröffentlicht ist: Kurs übernehmen und die
 * gespeicherten Originalbeträge in Euro umrechnen. true, wenn sich etwas geändert hat.
 */
export async function applyRateToDraft(tx: Tx, invoice: Invoice): Promise<boolean> {
  // Ohne Kurs oder mit übernommenem USt-Kurs: Ein eigener Kurs bleibt, ein geänderter Tabellenkurs (etwa der amtliche statt
  // eines vorab von Hand eingetragenen) gilt auch für den Entwurf
  if (invoice.status !== "draft" || invoice.currency === "EUR" || invoice.correctsId) return false;
  if (invoice.exchangeRate && invoice.exchangeRateSource !== "ust") return false;
  const rate = await resolveExchangeRate(
    tx,
    { currency: invoice.currency, date: serviceDate(invoice), exchangeRate: null, exchangeRateDate: null },
    null,
    false,
  );
  if (!rate.exchangeRate || (invoice.exchangeRate && parseExchangeRate(invoice.exchangeRate) === rate.exchangeRate)) return false;
  const rows = await tx.select().from(schema.invoiceTaxes).where(eq(schema.invoiceTaxes.invoiceId, invoice.id));
  const taxes = euroTaxes(
    rows.map((r) => ({ rate: r.rate, base: r.originalBase ?? 0, tax: r.originalTax ?? 0 })),
    invoice.currency,
    rate.exchangeRate,
  );
  if (taxes.some((t) => Math.abs(t.base) > MAX_EURO_CENTS || Math.abs(t.tax) > MAX_EURO_CENTS)) return false;
  await storeInvoiceTaxes(tx, invoice.id, taxes);
  const totals = totalsFromTaxes(taxes);
  await tx
    .update(schema.invoices)
    .set({ ...rate, net: totals.net, tax: totals.tax, gross: totals.gross, updatedAt: new Date() })
    .where(eq(schema.invoices.id, invoice.id));
  return true;
}

/** Entwürfe in Fremdwährung ohne Kurs oder mit geändertem USt-Kurs umrechnen (nach dem Abruf der Kurse); Zahl der Entwürfe */
export async function applyPublishedRatesToDrafts(actor: string): Promise<number> {
  const drafts = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "draft"),
        ne(schema.invoices.currency, "EUR"),
        sql`(${schema.invoices.exchangeRate} is null or ${schema.invoices.exchangeRateSource} = 'ust')`,
      ),
    );
  let count = 0;
  for (const { id } of drafts) {
    const changed = await withActor(actor, async (tx) => {
      const invoice = await lockInvoice(tx, id);
      return invoice ? applyRateToDraft(tx, invoice) : false;
    });
    if (changed) count++;
  }
  return count;
}
