import { formatEuro, monthsOfPeriod, type VatPeriod } from "@haben/core";
import { eq } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceVatDate } from "./invoice-tax.ts";

/** Ein bereits übermittelter Voranmeldungszeitraum; `month` ist der Zeitraum, nicht der Monat (Q1 = 41) */
export interface GemeldeterZeitraum {
  year: number;
  month: number;
  sentAt?: Date | null;
}

/** Liegt der Tag in einem Zeitraum, dessen Voranmeldung schon übermittelt ist? Gibt diesen Zeitraum zurück, sonst null. */
export function gemeldeterZeitraum(tag: string, zeitraeume: GemeldeterZeitraum[]): GemeldeterZeitraum | null {
  const [jahr, monat] = tag.split("-").map(Number);
  for (const zeitraum of zeitraeume) {
    if (zeitraum.year !== jahr) continue;
    if (monthsOfPeriod(zeitraum as VatPeriod).some((teil) => teil.month === monat)) return zeitraum;
  }
  return null;
}

/** „Q2/2026" für ein Quartal, „05/2026" für einen Monat */
export function zeitraumLabel({ year, month }: GemeldeterZeitraum): string {
  if (month > 12) return `Q${month - 40}/${year}`;
  return `${String(month).padStart(2, "0")}/${year}`;
}

const deutsch = (tag: string) => tag.split("-").reverse().join(".");

/**
 * Hinweis statt Sperre (#694): Die Meldung der Rechnung gehört in einen Zeitraum, dessen Voranmeldung schon übermittelt
 * ist. Eine spätere Voranmeldung enthält sie nicht, weil Haben nach dem Leistungstag zuordnet; die übermittelte ist zu
 * berichtigen (§ 18b Satz 5 UStG, § 153 Abs. 1 AO).
 */
export function leistungsmonatHinweis(tag: string, zeitraeume: GemeldeterZeitraum[], betrag: { net: number; tax: number }): string | null {
  const zeitraum = gemeldeterZeitraum(tag, zeitraeume);
  if (!zeitraum) return null;
  const label = zeitraumLabel(zeitraum);
  const abgabe = zeitraum.sentAt ? `, übermittelt am ${deutsch(zeitraum.sentAt.toISOString().slice(0, 10))}` : "";
  return (
    `Die Leistung vom ${deutsch(tag)} gehört in die Voranmeldung ${label}${abgabe}. Dort fehlt diese Rechnung ` +
    `(netto ${formatEuro(betrag.net)}, Umsatzsteuer ${formatEuro(betrag.tax)}), und keine spätere Voranmeldung enthält sie. ` +
    `Lege unter Umsatzsteuer für ${label} eine berichtigte Anmeldung an.`
  );
}

/**
 * Hinweis zu einer festgeschriebenen Rechnung, nur wenn der Leistungstag ihre Meldung in einen schon übermittelten Zeitraum
 * verschiebt. Ist-Versteuerung, Anzahlungen, Stornos und Korrekturen meldet Haben nicht nach dem Leistungstag.
 */
export async function leistungsmonatHinweisFuer(invoice: typeof schema.invoices.$inferSelect, q: Db | Tx = db): Promise<string | null> {
  if (invoice.status !== "final" || invoice.kind !== "rechnung") return null;
  const tag = await invoiceVatDate(invoice, q);
  if (tag === invoice.issueDate) return null;
  const gesendet = await q
    .select({
      year: schema.vatReturns.year,
      month: schema.vatReturns.month,
      sentAt: schema.vatReturns.sentAt,
    })
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.status, "sent"))
    .orderBy(schema.vatReturns.sentAt);
  return leistungsmonatHinweis(tag, gesendet, {
    net: invoice.net,
    tax: invoice.tax,
  });
}
