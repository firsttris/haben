import { numberFormatError } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany, type Company } from "../stammdaten/index.ts";
import { startRunning } from "./number-counter.ts";

/** Nummernformate für Rechnungen und Angebote; sie gelten für alles, was ab dann festgeschrieben wird */

export class NumberFormatError extends UserError {}

export interface NumberFormats {
  invoice: string;
  quote: string;
  /** Zähler läuft über den Jahreswechsel weiter (#328); fehlt = unverändert */
  invoiceRunning?: boolean;
  quoteRunning?: boolean;
  /** Jeder Kunde bekommt einen eigenen Nummernkreis (#1426); fehlt = unverändert */
  invoicePerCustomer?: boolean;
  quotePerCustomer?: boolean;
}

export async function saveNumberFormats(actor: string, formats: NumberFormats): Promise<void> {
  const company = await loadCompany();
  await withActor(actor, (tx) => putNumberFormats(tx, formats, company));
}

/** saveNumberFormats in der Transaktion des Aufrufers; `current` sagt, welche Zähler schon über den Jahreswechsel laufen und je Kunde kreisen */
export async function putNumberFormats(
  tx: Tx,
  formats: NumberFormats,
  current: Pick<Company, "invoiceCounterRunning" | "quoteCounterRunning" | "invoiceCounterPerCustomer" | "quoteCounterPerCustomer">,
): Promise<void> {
  const invoice = formats.invoice.trim();
  const quote = formats.quote.trim();
  const invoiceRunning = formats.invoiceRunning ?? current.invoiceCounterRunning;
  const quoteRunning = formats.quoteRunning ?? current.quoteCounterRunning;
  const invoicePerCustomer = formats.invoicePerCustomer ?? current.invoiceCounterPerCustomer;
  const quotePerCustomer = formats.quotePerCustomer ?? current.quoteCounterPerCustomer;
  for (const [label, format, running, perCustomer] of [
    ["Rechnungen", invoice, invoiceRunning, invoicePerCustomer],
    ["Angebote", quote, quoteRunning, quotePerCustomer],
  ] as const) {
    // Beginnt der Zähler jedes Jahr neu, macht erst das Jahr die Nummer eindeutig; läuft er durch, reicht der Zähler.
    // {KUNDENNR} trägt die Kundennummer des Käufers ein (#1426) — kreist der Zähler je Kunde, macht sie den Beleg
    // erst dem Kreis zuordenbar und ist Pflicht.
    const problem = numberFormatError(format, { requireYear: !running, allowCustomer: true, requireCustomer: perCustomer });
    if (problem) throw new NumberFormatError(`Nummernformat für ${label}: ${problem}`);
  }
  if (invoiceRunning && !current.invoiceCounterRunning) await startRunning(tx, "rechnung", null);
  if (quoteRunning && !current.quoteCounterRunning) await startRunning(tx, "angebot", null);
  await tx
    .update(schema.company)
    .set({
      invoiceNumberFormat: invoice,
      quoteNumberFormat: quote,
      invoiceCounterRunning: invoiceRunning,
      quoteCounterRunning: quoteRunning,
      invoiceCounterPerCustomer: invoicePerCustomer,
      quoteCounterPerCustomer: quotePerCustomer,
      updatedAt: new Date(),
    })
    .where(eq(schema.company.id, 1));
}
