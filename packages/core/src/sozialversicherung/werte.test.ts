import { describe, expect, it } from "vitest";
import { type Dezimal, vergleich } from "../lohnsteuer/dezimal.ts";
import { PAP_2026 } from "../lohnsteuer/pap-2026.ts";
import { beitrag } from "./rechnen.ts";
import { SV_2026, type SvJahreswerte } from "./werte.ts";

/** Gleich im Zahlenwert: Cent bzw. Basispunkte als Dezimalzahl wie im PAP (930 Basispunkte = 0,093) */
const gleich = (pap: Dezimal, wert: number, stellen: number) => vergleich(pap, { wert: BigInt(wert), stellen }) === 0;

describe("Sozialversicherungswerte 2026", () => {
  it("nennt für jeden Wert eine Quelle", () => {
    const felder = Object.keys(SV_2026.werte) as (keyof SvJahreswerte)[];
    expect(Object.keys(SV_2026.quellen).sort()).toEqual([...felder].sort());
    for (const feld of felder) expect(SV_2026.quellen[feld].length, feld).toBeGreaterThan(10);
  });

  it("ergibt den bekannt gemachten Faktor F aus 28 % durch den Gesamtsozialversicherungsbeitragssatz", () => {
    // § 20 Abs. 2a Satz 2 SGB IV; BAnz AT 18.12.2025 B5: 42,3 % und 0,6619 (auf vier Dezimalstellen gerundet)
    const w = SV_2026.werte;
    const gesamt = w.kv + w.kvZusatzDurchschnitt + w.pv + w.rv + w.av;
    expect(gesamt).toBe(4230);
    // 28 % / 42,3 % in Zehntausendsteln, kaufmännisch gerundet
    expect(beitrag(2800, 10_000 * 10_000, gesamt)).toBe(w.faktorF);
  });

  it("passt zu den Werten im PAP 2026 der Lohnsteuer", () => {
    const w = SV_2026.werte;
    // Jahresgrenzen im PAP in Euro, Sätze als Anteil des Arbeitnehmers. Die KV fehlt: Der PAP nimmt für die
    // Vorsorgepauschale den ermäßigten Satz (§ 243 SGB V, 14,0 %), Beiträge zahlt man zum allgemeinen.
    const paare: [Dezimal, number, number][] = [
      [PAP_2026.BBGKVPV, w.bbgKvPv * 12, 2],
      [PAP_2026.BBGRVALV, w.bbgRvAv * 12, 2],
      [PAP_2026.RVSATZAN, w.rv / 2, 4],
      [PAP_2026.AVSATZAN, w.av / 2, 4],
      [PAP_2026.pvSatzAn, w.pv / 2, 4],
      [PAP_2026.pvSatzAnSachsen, w.pvAnSachsen, 4],
      [PAP_2026.pvZuschlagKinderlos, w.pvZuschlagKinderlos, 4],
      [PAP_2026.pvAbschlagJeKind, w.pvAbschlagJeKind, 4],
    ];
    expect(paare.map(([pap, wert, stellen]) => gleich(pap, wert, stellen))).toEqual(paare.map(() => true));
    expect(w.pvAnSachsen + w.pvAgSachsen).toBe(w.pv);
  });

  it("hält den Übergangsbereich zwischen Geringfügigkeitsgrenze und 2.000 €", () => {
    expect(SV_2026.werte.geringfuegigkeitsgrenze).toBe(603_00);
    expect(SV_2026.werte.uebergangsbereichBis).toBe(2000_00);
  });
});
