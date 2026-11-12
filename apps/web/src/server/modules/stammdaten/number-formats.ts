import { numberFormatError } from "@haben/core";
import { and, eq, ne, or } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { startRunning } from "../rechnungen/index.ts";
import { loadCompany } from "./company.ts";

/** Nummernformate für Rechnungen und Angebote; sie gelten für alles, was ab dann festgeschrieben wird */

export class NumberFormatError extends UserError {}

export interface NumberFormats {
  invoice: string;
  quote: string;
  /** Zähler läuft über den Jahreswechsel weiter (#328); fehlt = unverändert */
  invoiceRunning?: boolean;
  quoteRunning?: boolean;
}

export async function saveNumberFormats(actor: string, formats: NumberFormats): Promise<void> {
  const company = await loadCompany();
  const invoice = formats.invoice.trim();
  const quote = formats.quote.trim();
  const invoiceRunning = formats.invoiceRunning ?? company.invoiceCounterRunning;
  const quoteRunning = formats.quoteRunning ?? company.quoteCounterRunning;
  for (const [label, format, running] of [
    ["Rechnungen", invoice, invoiceRunning],
    ["Angebote", quote, quoteRunning],
  ] as const) {
    // Beginnt der Zähler jedes Jahr neu, macht erst das Jahr die Nummer eindeutig; läuft er durch, reicht der Zähler
    const problem = numberFormatError(format, { requireYear: !running });
    if (problem) throw new NumberFormatError(`Nummernformat für ${label}: ${problem}`);
  }
  await withActor(actor, async (tx) => {
    if (invoiceRunning && !company.invoiceCounterRunning) await startRunning(tx, "rechnung");
    if (quoteRunning && !company.quoteCounterRunning) await startRunning(tx, "angebot");
    await tx
      .update(schema.company)
      .set({
        invoiceNumberFormat: invoice,
        quoteNumberFormat: quote,
        invoiceCounterRunning: invoiceRunning,
        quoteCounterRunning: quoteRunning,
        updatedAt: new Date(),
      })
      // Unveränderte Verwaltungswerte wählen keinen Steuerstatus und erzeugen keinen uneindeutigen Audit-Eintrag.
      .where(
        and(
          eq(schema.company.id, 1),
          or(
            ne(schema.company.invoiceNumberFormat, invoice),
            ne(schema.company.quoteNumberFormat, quote),
            ne(schema.company.invoiceCounterRunning, invoiceRunning),
            ne(schema.company.quoteCounterRunning, quoteRunning),
          ),
        ),
      );
  });
}
