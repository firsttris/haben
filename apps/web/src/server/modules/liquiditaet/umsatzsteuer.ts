import {
  ACCOUNTS,
  monthsOfPeriod,
  offeneUstZeitraeume,
  openFilingPeriod,
  sondervorauszahlungsPosten,
  umsatzsteuerPosten,
  type Cents,
  type LiquiditaetsPosten,
  type UstZeitraum,
} from "@haben/core";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { abgegebeneZeitraeume, computedValues, kz39For, loadDauerfrist, loadFrequencies } from "../umsatzsteuer/index.ts";
import type { Kontext } from "./kontext.ts";

/*
 * Umsatzsteuer der noch nicht abgegebenen Zeiträume (#1381): Was bis heute gebucht ist (Kz 83 wie in der Voranmeldung,
 * `computedValues`), plus die Steuer der erwarteten Posten, die im Zeitraum entsteht (`umsatzsteuerPosten` im Kern).
 * Abgegebene Voranmeldungen kommen als offene Posten (offene-posten.ts). Kleinunternehmer geben keine ab.
 */

/** Zeiträume ab dem ältesten noch nicht abgegebenen (wie /umsatzsteuer, `openFilingPeriod`), sonst ab dem laufenden */
async function zeitraeume(k: Kontext): Promise<(UstZeitraum & { gebucht: Cents })[]> {
  const [frequencies, dauerfrist, abgegeben] = await Promise.all([loadFrequencies(), loadDauerfrist(), abgegebeneZeitraeume()]);
  const heute = { year: Number(k.heute.slice(0, 4)), month: Number(k.heute.slice(5, 7)) };
  const offen = openFilingPeriod(frequencies, heute, abgegeben);
  const ab = offen ? monthsOfPeriod(offen)[0]! : heute;
  const liste = offeneUstZeitraeume({ ab, bis: k.bis, frequencies, dauerfrist, abgegeben, bundesland: k.bundesland }).filter((z) => !k.kleinunternehmer(z.von));
  const ergebnis: (UstZeitraum & { gebucht: Cents })[] = [];
  // Nacheinander: jede Rechnung liest das ganze Journal des Zeitraums
  for (const z of liste) {
    // Ein Zeitraum, der erst nach heute beginnt, hat noch keine Buchungen; nur die Sondervorauszahlung wird abgezogen (Kz 39)
    const gebucht = z.von > k.heute ? -(await kz39For(z.zeitraum)) : (await computedValues(z.zeitraum)).kz83;
    ergebnis.push({ ...z, gebucht });
  }
  return ergebnis;
}

/** Jahre, für die eine Sondervorauszahlung auf dem Konto „Umsatzsteuer-Vorauszahlungen 1/11“ gebucht ist */
async function sondervorauszahlungGezahlt(k: Kontext): Promise<Set<number>> {
  const konto = ACCOUNTS[k.kontenrahmen].sondervorauszahlung;
  const rows = await db.execute<{ jahr: number }>(sql`
    select distinct extract(year from e.date)::int as jahr from journal_lines l join journal_entries e on e.id = l.entry_id
    where l.account = ${konto} and l.debit > 0 and e.date >= ${`${k.heute.slice(0, 4)}-01-01`}`);
  return new Set([...rows].map((r) => Number(r.jahr)));
}

/**
 * Geschätzte Umsatzsteuer je offenem Zeitraum aus den übrigen Posten der Vorschau und die Sondervorauszahlung. `posten`
 * sind alle anderen Posten; ihre Steuer (`steuer`) geht in den Zeitraum, in dem sie entsteht.
 */
export async function umsatzsteuerPostenLaden(k: Kontext, posten: readonly LiquiditaetsPosten[]): Promise<LiquiditaetsPosten[]> {
  const liste = await zeitraeume(k);
  const [frequencies, dauerfrist, gezahlt] = await Promise.all([loadFrequencies(), loadDauerfrist(), sondervorauszahlungGezahlt(k)]);
  const svz = k.kleinunternehmer(k.heute)
    ? []
    : sondervorauszahlungsPosten({ heute: k.heute, bis: k.bis, frequencies, dauerfrist, gezahlt, bundesland: k.bundesland });
  return [...umsatzsteuerPosten(liste, posten), ...svz];
}
