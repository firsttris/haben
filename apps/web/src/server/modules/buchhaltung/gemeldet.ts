import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Gemeldete Zeiträume: Was in einer gesendeten Voranmeldung, einer gesendeten Jahreserklärung oder einem abgeschlossenen
 * Jahr steht, ändert eine neue Buchung nicht mehr. Storno eines Belegs und freie Buchungen (docs/adr/journal-als-quelle.md,
 * Entscheidung 4) richten ihr Datum danach.
 */

/** Monat und Quartal (41–44 wie in vat_returns), in deren Voranmeldung eine Buchung mit diesem Datum zählt */
export function vatPeriodsOf(date: string): { year: number; months: number[] } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return { year, months: [month, 40 + Math.ceil(month / 3)] };
}

/**
 * Ist der Zeitraum eines Buchungsdatums schon gemeldet? Eine gesendete oder vermerkte Voranmeldung für den Monat oder das
 * Quartal (je nach Einstellung gibt es nur eins von beiden), eine gesendete Jahreserklärung des Jahres oder ein
 * abgeschlossenes Jahr. Jede Jahreserklärung zählt: Bei einer GmbH meldet die E-Bilanz (mit KSt und GewSt) die Zahlen
 * des Jahres, auch ohne Voranmeldung oder Umsatzsteuererklärung (Kleinunternehmer, befreit); ebenso die ESt-Erklärung.
 */
export async function periodReported(q: Db | Tx, date: string): Promise<boolean> {
  const { year, months } = vatPeriodsOf(date);
  const r = schema.vatReturns;
  const [sent] = await q
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.year, year), inArray(r.month, months), eq(r.status, "sent")))
    .limit(1);
  if (sent) return true;
  const a = schema.annualSubmissions;
  const [annual] = await q
    .select({ id: a.id })
    .from(a)
    .where(and(eq(a.year, year), inArray(a.kind, ["send", "vermerk"]), eq(a.ok, true)))
    .limit(1);
  if (annual) return true;
  const [closed] = await q.select({ year: schema.yearClosings.year }).from(schema.yearClosings).where(eq(schema.yearClosings.year, year));
  return Boolean(closed);
}
