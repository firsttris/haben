import { describe, expect, it } from "vitest";
import { postenOf } from "./hgb.ts";
import { KAPG_STEUER_KONTEN, kapgSteuern } from "./koerperschaft.ts";

const ohneVortrag = { hebesatz: 400, verlustvortragKst: 0, verlustvortragGewst: 0 };

describe("Körperschaft- und Gewerbesteuer", () => {
  it.each([
    ["SKR03", { kst: "2200", soli: "2208", gewst: "4320", bewirtung: "4650" }],
    ["SKR04", { kst: "7600", soli: "7608", gewst: "7610", bewirtung: "6640" }],
  ] as const)("%s: gebuchte Steuern und 30 %% Bewirtung zurück, Verlustvortrag, Rückstellung", (kontenrahmen, k) => {
    // Jahresüberschuss 100.000 € nach Vorauszahlungen (KSt 2.000, Soli 110, GewSt 3.000) und 1.000 € Bewirtung
    const s = kapgSteuern(
      kontenrahmen,
      2026,
      [
        { account: k.kst, saldo: 200_000 },
        { account: k.soli, saldo: 11_000 },
        { account: k.gewst, saldo: 300_000 },
        { account: k.bewirtung, saldo: 100_000 },
      ],
      10_000_000,
      { hebesatz: 400, verlustvortragKst: 500_000, verlustvortragGewst: 0 },
    );
    expect(s.hinzurechnungen.map((z) => [z.gk, z.betrag])).toEqual([
      ["kst", 200_000],
      ["soli", 11_000],
      ["gewst", 300_000],
      ["sonstige", 30_000],
    ]);
    expect(s.einkommen).toBe(10_541_000);
    expect(s.verlustabzugKst).toBe(500_000);
    expect(s.zvE).toBe(10_041_000);
    expect(s.kst).toBe(1_506_150);
    // 5,5 % von 15.061,50 € = 828,3825 €, Bruchteile eines Cents bleiben außer Ansatz
    expect(s.soli).toBe(82_838);
    expect(s.verlustvortragKst).toBe(0);
    // 105.410 € auf volle 100 € abgerundet, 3,5 %, Hebesatz 400 %
    expect(s.gewerbeertrag).toBe(10_540_000);
    expect(s.messbetrag).toBe(368_900);
    expect(s.gewst).toBe(1_475_600);
    expect(s.gebucht).toEqual({ kst: 200_000, soli: 11_000, gewst: 300_000 });
    expect(s.rueckstellung).toEqual({ kst: 1_506_150 + 82_838 - 211_000, gewst: 1_475_600 - 300_000 });
  });

  it("eine gebuchte Rückstellung ändert die Steuer nicht", () => {
    const vorher = kapgSteuern("SKR04", 2026, [], 5_000_000, ohneVortrag);
    const nachher = kapgSteuern(
      "SKR04",
      2026,
      [
        { account: "7600", saldo: vorher.kst },
        { account: "7608", saldo: vorher.soli },
        { account: "7610", saldo: vorher.gewst },
      ],
      5_000_000 - vorher.kst - vorher.soli - vorher.gewst,
      ohneVortrag,
    );
    expect(nachher.kst).toBe(vorher.kst);
    expect(nachher.gewst).toBe(vorher.gewst);
    expect(nachher.rueckstellung).toEqual({ kst: 0, gewst: 0 });
  });

  it.each([
    // 2024 bis 2027: 70 % über 1 Mio. € bei der Körperschaftsteuer, Gewerbesteuer bleibt bei 60 %
    [2026, 240_000_000, 220_000_000],
    [2028, 220_000_000, 220_000_000],
  ])("Mindestbesteuerung %i", (year, kst, gewst) => {
    const s = kapgSteuern("SKR03", year, [], 300_000_000, { hebesatz: 400, verlustvortragKst: 500_000_000, verlustvortragGewst: 500_000_000 });
    expect(s.verlustabzugKst).toBe(kst);
    expect(s.verlustabzugGewst).toBe(gewst);
    expect(s.verlustvortragKst).toBe(500_000_000 - kst);
  });

  it("Verlust: keine Steuer, Vortrag wächst; Erstattung der Vorauszahlungen als negative Rückstellung", () => {
    const s = kapgSteuern("SKR03", 2026, [{ account: "2200", saldo: 100_000 }], -2_100_000, {
      hebesatz: 400,
      verlustvortragKst: 500_000,
      verlustvortragGewst: 0,
    });
    expect(s.einkommen).toBe(-2_000_000);
    expect([s.zvE, s.kst, s.soli, s.gewst]).toEqual([0, 0, 0, 0]);
    expect(s.verlustvortragKst).toBe(2_500_000);
    expect(s.verlustvortragGewst).toBe(2_000_000);
    expect(s.rueckstellung.kst).toBe(-100_000);
  });

  it("Hinzurechnung nach § 8 Nr. 1 GewStG erst über 200.000 €", () => {
    const klein = kapgSteuern("SKR04", 2026, [{ account: "6310", saldo: 2_400_000 }], 1_000_000, ohneVortrag);
    expect(klein.hinzurechnungGewst).toBe(0);
    // Zinsen 150.000 € voll, Miete 200.000 € zur Hälfte: 250.000 € − 200.000 € Freibetrag, davon ein Viertel
    const gross = kapgSteuern(
      "SKR03",
      2026,
      [
        { account: "2100", saldo: 15_000_000 },
        { account: "4210", saldo: 20_000_000 },
      ],
      1_000_000,
      ohneVortrag,
    );
    expect(gross.hinzurechnungGewst).toBe(1_250_000);
    expect(gross.gewerbeertrag).toBe(2_250_000);
  });

  it.each(["SKR03", "SKR04"] as const)("%s: die Konten stehen im DATEV-Kontenrahmen, wo die Berechnung sie erwartet", (kontenrahmen) => {
    const k = KAPG_STEUER_KONTEN[kontenrahmen];
    for (const account of [...k.kst, ...k.soli, ...k.gewst, ...k.kstVorjahre, ...k.soliWeitere, ...k.kapest, ...k.gewstVorjahre])
      expect(postenOf(kontenrahmen, account), account).toBe("steuern");
    for (const account of k.nichtAbziehbar) expect(postenOf(kontenrahmen, account), account).toBe("sonstigeAufwendungen");
    for (const account of [k.rueckstellungKst, k.rueckstellungGewst]) expect(postenOf(kontenrahmen, account), account).toBe("passiva.B");
  });
});
