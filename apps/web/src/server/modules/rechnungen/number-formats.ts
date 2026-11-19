import { numberFormatError, usesCustomerNumber } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany, type Company } from "../stammdaten/index.ts";
import { counterContacts, lockNumbering, seedCustomerCircles, startRunning, type NumberKind } from "./number-counter.ts";

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

/** Den durchlaufenden Kreis für den gemeinsamen und jeden vorhandenen Kundenkreis dieser Art hinter dessen Jahresnummer starten */
async function startCircles(tx: Tx, kind: NumberKind): Promise<void> {
  await startRunning(tx, kind, null);
  for (const contactId of await counterContacts(tx, kind)) await startRunning(tx, kind, contactId);
}

/** saveNumberFormats in der Transaktion des Aufrufers; `current` sagt, wie die Formate bisher lauten und welche Zähler schon über den Jahreswechsel laufen und je Kunde kreisen */
export async function putNumberFormats(
  tx: Tx,
  formats: NumberFormats,
  current: Pick<
    Company,
    "invoiceNumberFormat" | "quoteNumberFormat" | "invoiceCounterRunning" | "quoteCounterRunning" | "invoiceCounterPerCustomer" | "quoteCounterPerCustomer"
  >,
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
  // Wird der Zähler je Kunde neu eingeschaltet und trug das bisherige Format schon {KUNDENNR}, beginnt jeder Kunde
  // hinter seiner höchsten Nummer des gemeinsamen Kreises — sonst ergäbe die erste Nummer eine schon vergebene
  // (#1426). Vor startCircles, damit ein neu durchlaufender Kundenkreis den Stand gleich mitbekommt.
  const seedInvoices = invoicePerCustomer && !current.invoiceCounterPerCustomer && usesCustomerNumber(current.invoiceNumberFormat);
  const seedQuotes = quotePerCustomer && !current.quoteCounterPerCustomer && usesCustomerNumber(current.quoteNumberFormat);
  const startInvoices = invoiceRunning && (!current.invoiceCounterRunning || (invoicePerCustomer && !current.invoiceCounterPerCustomer));
  const startQuotes = quoteRunning && (!current.quoteCounterRunning || (quotePerCustomer && !current.quoteCounterPerCustomer));
  // Seed und startCircles nehmen die Hash-Kette; beide gemeinsamen Kreise 0 deshalb vorher sperren, sonst sperrt der
  // zweite Schritt seinen Kreis nach der Kette, umgekehrt zum Festschreiben (drizzle/0063), und Postgres verklemmt.
  if (seedInvoices || seedQuotes || startInvoices || startQuotes) {
    await lockNumbering(tx, "rechnung", 0, null);
    await lockNumbering(tx, "angebot", 0, null);
  }
  if (seedInvoices) await seedCustomerCircles(tx, "rechnung", invoiceRunning);
  if (seedQuotes) await seedCustomerCircles(tx, "angebot", quoteRunning);
  // Läuft der Zähler durch, bekommt jeder Kreis eine Zeile für den Kreis 0: neu eingeschaltet oder der Kundenkreis
  // neu dazu, je hinter der letzten Nummer des jüngsten Jahres desselben Kreises (startRunning, #1426). Kontakte
  // ohne Zählerzeile haben noch keine Nummer verbraucht und beginnen einfach bei 1 — es sei denn, sie sind oben
  // beim Einschalten eben hinter ihre Nummern aus dem gemeinsamen Kreis gesetzt worden.
  if (startInvoices) await startCircles(tx, "rechnung");
  if (startQuotes) await startCircles(tx, "angebot");
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
