import { describe, expect, it } from "vitest";
import { postenOf } from "./hgb.ts";
import { GEWST_HINZURECHNUNG_KONTEN, KAPG_STEUER_KONTEN, kapgSteuern, mindestHebesatz } from "./koerperschaft.ts";

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

  it.each([
    // § 16 Abs. 4 Satz 2 GewStG, 280 % erstmals für den Erhebungszeitraum 2027 (§ 36 Abs. 5b GewStG)
    [2026, 200],
    [2027, 280],
    [2028, 280],
  ])("Mindesthebesatz %i: %i", (year, prozent) => {
    expect(mindestHebesatz(year)).toBe(prozent);
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
    // Rücktrag von 15.000 € in die Vorjahre mindert den Vortrag, nicht den Gewerbeverlust
    const mitRuecktrag = kapgSteuern("SKR03", 2026, [], -2_000_000, {
      hebesatz: 400,
      verlustvortragKst: 0,
      verlustvortragGewst: 0,
      verlustruecktrag: 1_500_000,
    });
    expect([mitRuecktrag.verlustvortragKst, mitRuecktrag.verlustvortragGewst]).toEqual([500_000, 2_000_000]);
  });

  it.each([
    ["SKR03", { gewstVorjahre: "2281", zinsen: "2105", saeumnis: "2102", verspaetung: "4397", abziehbar: "2107" }],
    ["SKR04", { gewstVorjahre: "7641", zinsen: "7308", saeumnis: "7302", verspaetung: "6437", abziehbar: "7305" }],
  ] as const)("%s: Steuerzahlungen aus dem Bankabgleich, nicht abziehbare Nebenleistungen zurück, abziehbare nicht", (kontenrahmen, k) => {
    const s = kapgSteuern(
      kontenrahmen,
      2026,
      [
        { account: k.gewstVorjahre, saldo: 50_000 },
        { account: k.zinsen, saldo: 1_800 },
        { account: k.saeumnis, saldo: 500 },
        { account: k.verspaetung, saldo: 2_500 },
        // Zinsen zur Umsatzsteuer sind Betriebsausgaben
        { account: k.abziehbar, saldo: 4_000 },
      ],
      1_000_000,
      ohneVortrag,
    );
    expect(s.hinzurechnungen.map((z) => [z.gk, z.betrag])).toEqual([
      ["gewst", 50_000],
      ["sonstige", 4_800],
    ]);
    expect(s.einkommen).toBe(1_054_800);
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

  it.each([
    ["SKR03", "4575", "4570"],
    ["SKR04", "6565", "6560"],
  ] as const)(
    "%s: Leasing für Elektrofahrzeuge und Fahrräder bis 2030 zur Hälfte von einem Fünftel, ab 2031 wie übriges Leasing",
    (kontenrahmen, elektro, leasing) => {
      // § 8 Nr. 1 Buchst. d Satz 2 GewStG, letztmals für den Erhebungszeitraum 2030 (§ 36 Abs. 4 Satz 3 GewStG)
      const gruppen = (year: number) =>
        kapgSteuern(
          kontenrahmen,
          year,
          [
            { account: elektro, saldo: 960_000 },
            { account: leasing, saldo: 1_200_000 },
          ],
          1_000_000,
          ohneVortrag,
        ).gewstHinzurechnungen.map((z) => [z.art, z.brutto, z.betrag]);
      expect(gruppen(2030)).toEqual([
        ["beweglich", 1_200_000, 240_000],
        ["elektro", 960_000, 96_000],
      ]);
      expect(gruppen(2031)).toEqual([["beweglich", 2_160_000, 432_000]]);
    },
  );

  it.each([
    ["SKR03", "4575", "4570"],
    ["SKR04", "6565", "6560"],
  ] as const)("%s: Leasing für Elektrofahrzeuge und Fahrräder vor 2020 wie übriges Leasing, ab 2020 zur Hälfte", (kontenrahmen, elektro, leasing) => {
    // § 36 Abs. 4 Satz 1 GewStG: nur Verträge, die nach dem 31.12.2019 abgeschlossen worden sind; im Erhebungszeitraum 2019 gibt es keine
    const gruppen = (year: number) =>
      kapgSteuern(
        kontenrahmen,
        year,
        [
          { account: elektro, saldo: 960_000 },
          { account: leasing, saldo: 1_200_000 },
        ],
        1_000_000,
        ohneVortrag,
      ).gewstHinzurechnungen.map((z) => [z.art, z.brutto, z.betrag]);
    expect(gruppen(2019)).toEqual([["beweglich", 2_160_000, 432_000]]);
    expect(gruppen(2020)).toEqual([
      ["beweglich", 1_200_000, 240_000],
      ["elektro", 960_000, 96_000],
    ]);
  });

  it("Der Freibetrag gilt für die Summe aller Gruppen, auch mit Elektrofahrzeugen und Fahrrädern", () => {
    // Zinsen 195.000 € voll, Leasing für Elektrofahrzeuge 100.000 € zu 10 %: 205.000 € − 200.000 € Freibetrag, davon ein Viertel
    const s = kapgSteuern(
      "SKR04",
      2026,
      [
        { account: "7300", saldo: 19_500_000 },
        { account: "6565", saldo: 10_000_000 },
      ],
      1_000_000,
      ohneVortrag,
    );
    expect(s.hinzurechnungGewst).toBe(125_000);
  });

  /*
   * Weitere Konten mit Kennzeichen G im DATEV-Kontenrahmen 2026 (#1265): Zinsen an verbundene Unternehmen, auf
   * Kontokorrentkonten und für Gebäude (§ 8 Nr. 1 a), Mietleasing für technische Anlagen und Maschinen und für
   * Betriebs- und Geschäftsausstattung (d), Garagenmiete (e)
   */
  it.each([
    ["SKR03", ["2109", "2118", "2119", "2125", "2129"], ["4810", "4965"], ["4550"]],
    ["SKR04", ["7309", "7318", "7319", "7325", "7329"], ["6498", "6840"], ["6550"]],
  ] as const)("%s: Zinsen, bewegliche und unbewegliche Wirtschaftsgüter aus allen Konten mit Kennzeichen G", (kontenrahmen, zinsen, beweglich, unbeweglich) => {
    const brutto = (account: string, art: string) =>
      kapgSteuern(kontenrahmen, 2026, [{ account, saldo: 100_000 }], 1_000_000, ohneVortrag).gewstHinzurechnungen.find((z) => z.art === art)?.brutto;
    for (const account of zinsen) expect(brutto(account, "zinsen"), account).toBe(100_000);
    for (const account of beweglich) expect(brutto(account, "beweglich"), account).toBe(100_000);
    for (const account of unbeweglich) expect(brutto(account, "unbeweglich"), account).toBe(100_000);
  });

  it.each([
    ["SKR03", "2118", "2127"],
    ["SKR04", "7318", "7327"],
  ] as const)("%s: Renten und dauernde Lasten voll vor dem Freibetrag (§ 8 Nr. 1 b GewStG)", (kontenrahmen, kontokorrent, renten) => {
    // Kontokorrentzinsen 150.000 € und Renten 100.000 € voll: 250.000 € − 200.000 € Freibetrag, davon ein Viertel
    const s = kapgSteuern(
      kontenrahmen,
      2026,
      [
        { account: kontokorrent, saldo: 15_000_000 },
        { account: renten, saldo: 10_000_000 },
      ],
      1_000_000,
      ohneVortrag,
    );
    expect(s.gewstHinzurechnungen.map((z) => [z.art, z.brutto, z.betrag])).toEqual([
      ["zinsen", 15_000_000, 15_000_000],
      ["renten", 10_000_000, 10_000_000],
    ]);
    expect(s.hinzurechnungGewst).toBe(1_250_000);
  });

  it.each([
    ["SKR03", ["2115", "2116"]],
    ["SKR04", ["7350", "7351"]],
  ] as const)("%s: Zinsen nach §§ 3 Nr. 40, 3c EStG bzw. § 8b KStG gehören nicht zur Hinzurechnung", (kontenrahmen, konten) => {
    // DATEV-Kontenrahmen 2026, Fußnote 9: die Schnittstelle zur Gewerbesteuer behandelt diese Aufwendungen gesondert
    for (const account of konten) {
      const s = kapgSteuern(kontenrahmen, 2026, [{ account, saldo: 100_000 }], 1_000_000, ohneVortrag);
      expect(s.gewstHinzurechnungen, account).toEqual([]);
    }
  });

  /*
   * Miete, Pacht und Lizenzen als Fremdleistungen tragen im DATEV-Kontenrahmen 2026 ebenfalls „G K“ (SKR03 S. 20,
   * SKR04 S. 21): Miet- und Pachtzinsen für bewegliche (§ 8 Nr. 1 d) und unbewegliche Wirtschaftsgüter (e), Entgelte für
   * Rechte und Lizenzen (f)
   */
  it.each([
    ["SKR03", "3170", "3175", "3180"],
    ["SKR04", "5970", "5975", "5980"],
  ] as const)("%s: Miete, Pacht und Lizenzen als Fremdleistungen zählen zur Hinzurechnung", (kontenrahmen, beweglich, unbeweglich, rechte) => {
    const brutto = (account: string, art: string) =>
      kapgSteuern(kontenrahmen, 2026, [{ account, saldo: 100_000 }], 1_000_000, ohneVortrag).gewstHinzurechnungen.find((z) => z.art === art)?.brutto;
    expect(brutto(beweglich, "beweglich"), beweglich).toBe(100_000);
    expect(brutto(unbeweglich, "unbeweglich"), unbeweglich).toBe(100_000);
    expect(brutto(rechte, "rechte"), rechte).toBe(100_000);
  });

  it("Jede Gruppe der Hinzurechnung hat in SKR03 und SKR04 gleich viele Konten", () => {
    const anzahl = (kontenrahmen: "SKR03" | "SKR04") =>
      Object.fromEntries(Object.entries(GEWST_HINZURECHNUNG_KONTEN[kontenrahmen]).map(([art, konten]) => [art, konten.length]));
    expect(anzahl("SKR04")).toEqual(anzahl("SKR03"));
  });

  it.each(["SKR03", "SKR04"] as const)("%s: die Konten stehen im DATEV-Kontenrahmen, wo die Berechnung sie erwartet", (kontenrahmen) => {
    const k = KAPG_STEUER_KONTEN[kontenrahmen];
    for (const account of [...k.kst, ...k.soli, ...k.gewst, ...k.kstVorjahre, ...k.soliWeitere, ...k.kapest, ...k.gewstVorjahre])
      expect(postenOf(kontenrahmen, account), account).toBe("steuern");
    for (const account of k.nichtAbziehbar) expect(postenOf(kontenrahmen, account), account).toBe("sonstigeAufwendungen");
    for (const account of [k.rueckstellungKst, k.rueckstellungGewst]) expect(postenOf(kontenrahmen, account), account).toBe("passiva.B");
  });
});
