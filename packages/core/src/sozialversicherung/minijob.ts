import { beitrag } from "./rechnen.ts";
import { KEINE, type Minijob, mitSummen, type SvBeitraege } from "./typen.ts";
import type { SvJahreswerte } from "./werte.ts";

/**
 * Rentenversicherung im Minijob. Der Arbeitgeber zahlt den Pauschalbeitrag vom tatsächlichen Entgelt; ohne Befreiung
 * trägt der Beschäftigte den Rest bis zum vollen Beitrag, mindestens aus 175 € (§ 168 Abs. 1 Nr. 1b SGB VI,
 * § 163 Abs. 8 SGB VI). Der Anteil des Beschäftigten ist ein eigener, getrennt gerundeter Anteil (§ 2 Abs. 1
 * Satz 3 BVV); ungerundet gerechnet wie im Beispiel der Minijob-Zentrale (100 €: 3,6 % + 75 € × 18,6 % = 17,55 €).
 */
function rente(e: Minijob, w: SvJahreswerte): { bemessung: number; an: number; ag: number } {
  const ag = beitrag(e.entgelt, w.minijobRvAg);
  if (e.rvBefreit) return { bemessung: e.entgelt, an: 0, ag };
  const bemessung = Math.max(e.entgelt, w.minijobRvMindestbemessung);
  // Zähler in Cent mal Basispunkten; Rechnung ohne Rundung der Zwischenergebnisse (§ 1 Abs. 2 BVV)
  const an = beitrag(1, bemessung * w.rv - e.entgelt * w.minijobRvAg);
  return { bemessung, an, ag };
}

/**
 * Gewerblicher Minijob: Pauschalen an die Minijob-Zentrale, Umlagen U1/U2 zu deren Sätzen, Insolvenzgeldumlage,
 * keine Beiträge zur Pflege- und Arbeitslosenversicherung. Bemessung ist das tatsächliche Entgelt; die
 * Mindestbemessung von 175 € gilt nur für den Rentenbeitrag.
 */
export function minijob(e: Minijob, w: SvJahreswerte): SvBeitraege {
  const rv = rente(e, w);
  return mitSummen({
    personengruppe: "minijob",
    bemessung: { kvPv: e.entgelt, rvAv: rv.bemessung, arbeitnehmer: null },
    kv: { an: 0, ag: e.gesetzlichKrankenversichert ? beitrag(e.entgelt, w.minijobKv) : 0 },
    pv: KEINE,
    rv: { an: rv.an, ag: rv.ag },
    av: KEINE,
    umlagen: {
      u1: e.u1 ? beitrag(e.entgelt, w.minijobU1) : 0,
      u2: beitrag(e.entgelt, w.minijobU2),
      insolvenzgeld: beitrag(e.entgelt, w.insolvenzgeld),
    },
    pauschsteuer: e.pauschsteuer ? beitrag(e.entgelt, w.minijobPauschsteuer) : 0,
  });
}
