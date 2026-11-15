import type { Cents } from "./money.ts";
import { ACCOUNTS, KLEINUNTERNEHMER_FRUEHERE_KONTEN, type Kontenrahmen, type PostingLine } from "./posting.ts";

// Beträge in Cent. § 19 Abs. 1 UStG: Überschreiten, nicht Erreichen.
// https://www.gesetze-im-internet.de/ustg_1980/__19.html
export const VORJAHRESGRENZE = 2_500_000;
export const JAHRESGRENZE = 10_000_000;

/** UStAE 19.1 Abs. 3: Im Kalenderjahr der Tätigkeitsaufnahme gelten 25.000 €. */
export function kleinunternehmerJahresgrenze(datum: string, foundedOn: string | null) {
  const gruendungsjahr = datum.slice(0, 4) === foundedOn?.slice(0, 4);
  return { gruendungsjahr, jahresgrenze: gruendungsjahr ? VORJAHRESGRENZE : JAHRESGRENZE };
}

/** Vorwarnung ab vier Fünfteln der Grenze. */
export function umsatzgrenzeNahe(umsatz: Cents, grenze: Cents): boolean {
  return umsatz * 5 >= grenze * 4;
}

/**
 * § 19 Abs. 2 UStG: im Inland steuerbare Umsätze nach vereinnahmtem Nettoentgelt.
 * Ausfuhr und innergemeinschaftliche Lieferungen (§ 4 Nr. 1) zählen mit. Für das Sammelkonto
 * „Steuerfrei nach § 4“ fehlt die strukturierte Befreiungsvorschrift.
 * https://www.gesetze-im-internet.de/ustg_1980/__19.html
 */
export function kleinunternehmerKonten(kr: Kontenrahmen, zeilen: readonly Pick<PostingLine, "account" | "debit" | "credit">[]) {
  const a = ACCOUNTS[kr];
  const erloese: readonly string[] = [
    ...Object.values(a.erloese),
    a.erloeseSonder.kleinunternehmer,
    KLEINUNTERNEHMER_FRUEHERE_KONTEN[kr],
    a.erloeseSonder.ausfuhr,
    a.erloeseSonder.ig_lieferung,
  ];
  let netto = 0;
  let steuerfrei = false;
  for (const z of zeilen) {
    if (erloese.includes(z.account)) netto += z.credit - z.debit;
    if (z.account === a.erloeseSonder.steuerfrei && z.credit !== z.debit) steuerfrei = true;
  }
  return { netto, steuerfrei };
}
