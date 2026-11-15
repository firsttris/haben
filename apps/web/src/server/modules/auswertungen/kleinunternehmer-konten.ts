import { ACCOUNTS, KLEINUNTERNEHMER_FRUEHERE_KONTEN, type Kontenrahmen } from "@haben/core";
import type { Zeile } from "./euer-journal-buchungen.ts";

/**
 * § 19 Abs. 2 UStG: im Inland steuerbare Umsätze nach vereinnahmtem Nettoentgelt.
 * Ausfuhr und innergemeinschaftliche Lieferungen (§ 4 Nr. 1) zählen mit. Für das Sammelkonto
 * „Steuerfrei nach § 4“ fehlt die strukturierte Befreiungsvorschrift.
 * https://www.gesetze-im-internet.de/ustg_1980/__19.html
 */
export function kleinunternehmerKonten(kr: Kontenrahmen, zeilen: readonly Zeile[]) {
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
