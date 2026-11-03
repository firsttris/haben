import { numberFormatError } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "./company.ts";

/** Nummernformate für Rechnungen und Angebote; sie gelten für alles, was ab dann festgeschrieben wird */

export class NumberFormatError extends UserError {}

export interface NumberFormats {
  invoice: string;
  quote: string;
}

export async function saveNumberFormats(actor: string, formats: NumberFormats): Promise<void> {
  const invoice = formats.invoice.trim();
  const quote = formats.quote.trim();
  for (const [label, format] of [
    ["Rechnungen", invoice],
    ["Angebote", quote],
  ] as const) {
    const problem = numberFormatError(format);
    if (problem) throw new NumberFormatError(`Nummernformat für ${label}: ${problem}`);
  }
  await loadCompany();
  await withActor(actor, (tx) =>
    tx.update(schema.company).set({ invoiceNumberFormat: invoice, quoteNumberFormat: quote, updatedAt: new Date() }).where(eq(schema.company.id, 1)),
  );
}
