import { describe, expect, it } from "vitest";
import { einkommensteuer, gewinnAusPrognose, kirchensteuerpflichtig, solidaritaetszuschlag, steuerPrognose, type PrognoseInput } from "./income-tax.ts";

/** Referenzwerte aus dem BMF-Programmablaufplan (Paket lohnsteuer-bmf 2026.3): zvE, Grundtarif, Splitting, Soli einzeln, Soli zusammen */
const REFERENZ: Record<number, [number, number, number, number, number][]> = {
  2024: [
    [10_000, 0, 0, 0, 0],
    [15_000, 548, 0, 0, 0],
    [20_000, 1725, 0, 0, 0],
    [45_000, 9121, 4726, 0, 0],
    [70_000, 18_763, 11_782, 75.33, 0],
    [85_432, 25_245, 16_702, 846.68, 0],
    [150_000, 52_363, 41_726, 2879.97, 650.45],
    [300_000, 116_028, 104_726, 6381.54, 5759.93],
  ],
  2025: [
    [15_000, 485, 0, 0, 0],
    [20_000, 1639, 0, 0, 0],
    [45_000, 8961, 4544, 0, 0],
    [70_000, 18_488, 11_536, 0, 0],
    [85_432, 24_969, 16_402, 597.26, 0],
    [150_000, 52_088, 41_176, 2864.84, 151.84],
    [300_000, 115_753, 104_176, 6366.41, 5729.68],
  ],
  2026: [
    [15_000, 435, 0, 0, 0],
    [45_000, 8835, 4398, 0, 0],
    [85_432, 24_745, 16_164, 523, 0],
    [150_000, 51_864, 40_728, 2852.52, 3.33],
    [300_000, 115_529, 103_728, 6354.1, 5705.04],
  ],
};

describe("einkommensteuer", () => {
  for (const [year, rows] of Object.entries(REFERENZ)) {
    it(`entspricht dem BMF-Programmablaufplan ${year}`, () => {
      for (const [zvE, grund, splitting, soliEinzel, soliZusammen] of rows) {
        expect(einkommensteuer(zvE * 100, Number(year)), `${zvE}`).toBe(grund * 100);
        expect(einkommensteuer(zvE * 100, Number(year), true), `${zvE} Splitting`).toBe(splitting * 100);
        // Bruchteile eines Cents bleiben beim Soli außer Ansatz (§ 4 SolZG); die Referenz rundet kaufmännisch
        expect(Math.abs(solidaritaetszuschlag(grund * 100, Number(year)) - Math.round(soliEinzel * 100))).toBeLessThanOrEqual(1);
        expect(Math.abs(solidaritaetszuschlag(splitting * 100, Number(year), true) - Math.round(soliZusammen * 100))).toBeLessThanOrEqual(1);
      }
    });
  }

  it("ist an den Zonengrenzen stetig, auch 2023", () => {
    for (const year of [2023, 2024, 2025, 2026]) {
      for (let zvE = 10_000; zvE < 300_000; zvE += 1) {
        const step = einkommensteuer((zvE + 1) * 100, year) - einkommensteuer(zvE * 100, year);
        if (step < 0 || step > 100) throw new Error(`${year}: Sprung bei ${zvE}: ${step}`);
      }
    }
  });

  it("kennt 2023 und nimmt für spätere Jahre den jüngsten Tarif", () => {
    expect(einkommensteuer(10_908_00, 2023)).toBe(0);
    expect(einkommensteuer(10_909_00, 2023)).toBe(0);
    expect(einkommensteuer(50_000_00, 2027)).toBe(einkommensteuer(50_000_00, 2026));
    expect(() => einkommensteuer(1, 2019)).toThrow();
  });

  it("erkennt die Kirchensteuerpflicht am Religionsschlüssel", () => {
    expect(kirchensteuerpflichtig("02")).toBe(true);
    expect(kirchensteuerpflichtig("11")).toBe(false);
    expect(kirchensteuerpflichtig(undefined)).toBe(false);
  });
});

describe("steuerPrognose", () => {
  const base: PrognoseInput = {
    year: 2026,
    gewinn: 85_000_00,
    zusammen: true,
    kirche: { a: false, b: false },
    bundesland: "BW",
    angaben: {
      vorsorge: { a: { pkv: 6_000_00, ppv: 400_00 }, b: { gkv: 3_000_00, gpv: 600_00 }, sonstige: 500_00 },
      sonderausgaben: {},
      haushaltsnah: {},
      kinder: [],
    },
  };

  it("zieht Vorsorge und Sonderausgaben-Pauschbetrag ab und rechnet mit Splitting", () => {
    const p = steuerPrognose(base);
    // Basis 10.000 € liegt über dem Höchstbetrag von 2 × 2.800 €, die weitere Vorsorge fällt weg
    expect(p.vorsorge).toBe(10_000_00);
    expect(p.sonderausgaben).toBe(72_00);
    expect(p.zvE).toBe(85_000_00 - 10_000_00 - 72_00);
    expect(p.einkommensteuer).toBe(einkommensteuer(p.zvE, 2026, true));
    expect(p.soli).toBe(0);
    expect(p.kirchensteuer).toBe(0);
    expect(p.jeQuartal).toBe(Math.round(p.gesamt / 4 / 100) * 100);
  });

  it("begrenzt die Altersvorsorge auf den Höchstbetrag des Jahres (§ 10 Abs. 3 EStG)", () => {
    const einzeln = { ...base, year: 2025, zusammen: false, angaben: { ...base.angaben, vorsorge: { a: { rentenversicherung: 35_000_00 } } } };
    expect(steuerPrognose(einzeln).vorsorge).toBe(29_344_00);
    // Zusammenveranlagung: doppelter Höchstbetrag, auch wenn nur einer einzahlt
    expect(steuerPrognose({ ...einzeln, zusammen: true }).vorsorge).toBe(35_000_00);
    expect(steuerPrognose({ ...einzeln, zusammen: true, angaben: { ...einzeln.angaben, vorsorge: { a: { rentenversicherung: 70_000_00 } } } }).vorsorge).toBe(
      58_688_00,
    );
  });

  it("teilt den Höchstbetrag der Altersvorsorge mit der Basisrente (Rürup)", () => {
    // 20.000 € gesetzliche RV und 10.000 € Rürup: zusammen über dem Höchstbetrag von 29.344 €
    const einzeln: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: { ...base.angaben, vorsorge: { a: { rentenversicherung: 20_000_00, basisrente: 10_000_00 } } },
    };
    expect(steuerPrognose(einzeln).vorsorge).toBe(29_344_00);
    // Ohne Rürup bleibt Luft im Höchstbetrag
    expect(steuerPrognose({ ...einzeln, angaben: { ...einzeln.angaben, vorsorge: { a: { rentenversicherung: 20_000_00 } } } }).vorsorge).toBe(20_000_00);
  });

  it("zählt Wahlleistungen einer privaten KV zur übrigen Vorsorge", () => {
    const einzeln: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: { ...base.angaben, vorsorge: { a: { pkvWahlleistungen: 1_000_00 } } },
    };
    // Über der Basisabsicherung, also im Höchstbetrag der übrigen Vorsorge (2.800 € für Selbständige)
    expect(steuerPrognose(einzeln).vorsorge).toBe(1_000_00);
    expect(steuerPrognose({ ...einzeln, angaben: { ...einzeln.angaben, vorsorge: { a: { pkvWahlleistungen: 5_000_00 } } } }).vorsorge).toBe(2_800_00);
  });

  it("zieht steuerfreie Arbeitgeberzuschüsse von der Basisabsicherung ab", () => {
    const ohne: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: { ...base.angaben, vorsorge: { a: { pkv: 6_000_00, ppv: 0 } } },
    };
    expect(steuerPrognose(ohne).vorsorge).toBe(6_000_00);
    // Nr. 24 b und 24 c der Lohnsteuerbescheinigung mindern den abzugsfähigen Betrag
    const mitZuschuss: PrognoseInput = {
      ...ohne,
      angaben: {
        ...ohne.angaben,
        vorsorge: { a: { pkv: 6_000_00, agZuschussKv: 2_000_00, agZuschussPv: 200_00 } },
      },
    };
    expect(steuerPrognose(mitZuschuss).vorsorge).toBe(3_800_00);
    // Ein Zuschuss über den Beiträgen macht den Abzug nicht negativ
    const zuViel: PrognoseInput = {
      ...ohne,
      angaben: { ...ohne.angaben, vorsorge: { a: { pkv: 100_00, agZuschussKv: 2_000_00 } } },
    };
    expect(steuerPrognose(zuViel).vorsorge).toBe(0);
  });

  it("zieht den Zuschuss zur gesetzlichen KV (Nr. 24 a) bei freiwillig Versicherten ab (§ 10 Abs. 2 Satz 1 Nr. 1 EStG)", () => {
    // Selbstzahler: Beiträge in Zeile 16 (gkv), Zuschüsse laut Nr. 24 a und 24 c der Lohnsteuerbescheinigung
    const ohne: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: { ...base.angaben, vorsorge: { a: { gkv: 4_000_00, gpv: 1_000_00 } } },
    };
    expect(steuerPrognose(ohne).vorsorge).toBe(5_000_00);
    const mitZuschuss: PrognoseInput = {
      ...ohne,
      angaben: { ...ohne.angaben, vorsorge: { a: { gkv: 4_000_00, gpv: 1_000_00, agZuschussGkv: 2_000_00, agZuschussPv: 500_00 } } },
    };
    expect(steuerPrognose(mitZuschuss).vorsorge).toBe(2_500_00);
  });

  it("zieht den Zuschuss zur gesetzlichen KV in voller Höhe ab, auch neben Beiträgen mit Krankengeldanteil", () => {
    // Freiwillig gesetzlich versichert: Beiträge laut Nr. 25 der Bescheinigung, Zuschuss laut Nr. 24 a.
    // Die 4 % Krankengeldanteil kürzen nur den Beitrag (§ 10 Abs. 1 Nr. 3 Buchst. a EStG), der Zuschuss
    // mindert die Basisabsicherung vollständig und wird nicht aufgeteilt (§ 10 Abs. 2 Satz 1 Nr. 1 EStG,
    // BFH 2.9.2014, IX R 43/13).
    // Die Beiträge liegen über dem Höchstbetrag von 1.900 €, damit nur die Basisabsicherung zählt: Darunter
    // ergäbe jede Reihenfolge von Kürzung und Zuschuss dieselbe Summe aus Basis und übriger Vorsorge.
    const bescheinigung = { brutto: 60_000_00, kvArbeitnehmer: 4_000_00, pvArbeitnehmer: 1_000_00 };
    const ohne: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {} },
        arbeitnehmer: { a: { bescheinigungen: [bescheinigung], werbungskosten: {} } },
      },
    };
    // Basis 3.840 € + 1.000 €, der Krankengeldanteil von 160 € fällt unter den Höchstbetrag
    expect(steuerPrognose(ohne).vorsorge).toBe(4_840_00);
    const mitZuschuss: PrognoseInput = {
      ...ohne,
      angaben: { ...ohne.angaben, vorsorge: { a: { agZuschussGkv: 2_000_00 } } },
    };
    // In voller Höhe: 3.840 + 1.000 − 2.000 = 2.840. Zöge man den Zuschuss vor der Kürzung ab oder teilte ihn
    // 96 : 4 auf, wären es (4.000 − 2.000) × 96 % + 1.000 = 2.920
    expect(steuerPrognose(mitZuschuss).vorsorge).toBe(2_840_00);
  });

  it("rechnet Einkommensersatzleistungen über den Progressionsvorbehalt ein", () => {
    const ohne: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: { ...base.angaben, vorsorge: { a: {} }, ersatzleistungen: undefined },
    };
    const p0 = steuerPrognose(ohne);
    const leistung = 12_000_00;
    const mit = steuerPrognose({ ...ohne, angaben: { ...ohne.angaben, ersatzleistungen: { a: leistung } } });
    // Das zu versteuernde Einkommen bleibt gleich, der Steuersatz steigt. Ohne Arbeitslohn mindert der volle
    // Arbeitnehmer-Pauschbetrag von 1.230 € die Leistungen (§ 32b Abs. 2 Satz 1 Nr. 1 EStG).
    const vermehrt = leistung - 1_230_00;
    expect(mit.zvE).toBe(p0.zvE);
    expect(mit.einkommensteuer).toBe(Math.floor((einkommensteuer(mit.zvE + vermehrt, 2025, false) * mit.zvE) / (mit.zvE + vermehrt)));
    expect(mit.einkommensteuer).toBeGreaterThan(p0.einkommensteuer);
  });

  it("zieht den nicht verbrauchten Arbeitnehmer-Pauschbetrag von den Leistungen ab", () => {
    // Kleiner Arbeitslohn: der Pauschbetrag ist nur bis zum Lohn verbraucht, der Rest mindert die Leistung
    const mitArbeit: PrognoseInput = {
      ...base,
      year: 2025,
      zusammen: false,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {} },
        arbeitnehmer: { a: { bescheinigungen: [{ brutto: 500_00 }], werbungskosten: {} } },
        ersatzleistungen: { a: 400_00 },
      },
    };
    const ohneLeistung: PrognoseInput = {
      ...mitArbeit,
      angaben: { ...mitArbeit.angaben, ersatzleistungen: undefined },
    };
    expect(steuerPrognose(mitArbeit).einkommensteuer).toBe(steuerPrognose(ohneLeistung).einkommensteuer);
  });

  it("zieht ohne Arbeitslohn den vollen Arbeitnehmer-Pauschbetrag von den Leistungen ab (§ 32b Abs. 2 Satz 1 Nr. 1 EStG)", () => {
    // Freiberufler mit 10.000 € Elterngeld: in den besonderen Steuersatz gehen 10.000 € − 1.230 € = 8.770 € ein
    const p = steuerPrognose({
      ...base,
      year: 2025,
      gewinn: 50_000_00,
      zusammen: false,
      angaben: { ...base.angaben, vorsorge: { a: {} }, ersatzleistungen: { a: 10_000_00 } },
    });
    expect(p.zvE).toBe(50_000_00 - 36_00);
    expect(p.einkommensteuer).toBe(Math.floor((einkommensteuer(p.zvE + 8_770_00, 2025) * p.zvE) / (p.zvE + 8_770_00)));
    expect(p.einkommensteuer).toBe(11_844_90);
  });

  it("rechnet den Arbeitnehmer-Pauschbetrag je Person gegen deren Leistungen", () => {
    // Person A: 500 € Lohn, keine Leistungen. Person B: kein Lohn, 5.000 € Elterngeld, davon gehen 3.770 € ein.
    // Der Rest des Pauschbetrags von A mindert die Leistungen von B nicht.
    const p = steuerPrognose({
      ...base,
      year: 2025,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {}, b: {} },
        arbeitnehmer: { a: { bescheinigungen: [{ brutto: 500_00 }], werbungskosten: {} } },
        ersatzleistungen: { b: 5_000_00 },
      },
    });
    expect(p.einkommensteuer).toBe(Math.floor((einkommensteuer(p.zvE + 3_770_00, 2025, true) * p.zvE) / (p.zvE + 3_770_00)));
  });

  it("rechnet Arbeitslohn des Ehegatten ein und die Lohnsteuer an", () => {
    const p = steuerPrognose({
      ...base,
      angaben: {
        ...base.angaben,
        vorsorge: { a: base.angaben.vorsorge.a, b: {}, sonstige: 500_00 },
        arbeitnehmer: {
          b: {
            bescheinigungen: [
              {
                brutto: 42_000_00,
                lohnsteuer: 6_123_40,
                rvArbeitgeber: 3_906_05,
                rvArbeitnehmer: 3_906_05,
                kvArbeitnehmer: 3_412_04,
                pvArbeitnehmer: 756_01,
                avArbeitnehmer: 546_01,
              },
            ],
            // 2026: 180 × 23 × 0,38 € = 1.573,20 €, dazu Arbeitsmittel
            werbungskosten: { wege: { tage: 180, km: 23 }, arbeitsmittel: 349_00 },
          },
        },
      },
    });
    expect(p.einkuenfteArbeit).toBe(42_000_00 - 1_922_20);
    expect(p.gesamtbetragEinkuenfte).toBe(85_000_00 + 40_077_80);
    // Rente: Arbeitnehmeranteil; Basis: PKV/PPV von A, 96 % der GKV und die PV von B; über dem Höchstbetrag 2.800 € + 1.900 €
    expect(p.vorsorge).toBe(3_906_05 + 6_400_00 + 3_275_55 + 756_01);
    expect(p.steuerabzug).toBe(6_123_40);
    expect(p.verbleibend).toBe(p.gesamt - 6_123_40);
    expect(p.jeQuartal).toBe(Math.round(p.verbleibend / 4 / 100) * 100);
    // Ohne Zusammenveranlagung zählt der Arbeitslohn des Ehegatten nicht
    expect(
      steuerPrognose({
        ...base,
        zusammen: false,
        angaben: { ...base.angaben, arbeitnehmer: { b: { bescheinigungen: [{ brutto: 1_00 }], werbungskosten: {} } } },
      }).einkuenfteArbeit,
    ).toBe(0);
  });

  it("rechnet Kirchensteuer mit 8 % in BW, bei einem Ehegatten zur Hälfte", () => {
    const beide = steuerPrognose({ ...base, kirche: { a: true, b: true } });
    expect(beide.kirchensteuer).toBe(Math.floor(beide.einkommensteuer * 0.08));
    const einer = steuerPrognose({ ...base, kirche: { a: false, b: true } });
    expect(einer.kirchensteuer).toBe(Math.floor(einer.einkommensteuer * 0.04));
    expect(steuerPrognose({ ...base, bundesland: "NW", kirche: { a: true, b: true } }).kirchensteuer).toBe(Math.floor(beide.einkommensteuer * 0.09));
  });

  it("wählt bei hohem Einkommen den Kinderfreibetrag und rechnet das Kindergeld hinzu", () => {
    const hoch = steuerPrognose({ ...base, gewinn: 250_000_00, angaben: { ...base.angaben, kinder: [{}] } });
    expect(hoch.kinderfreibetrag).toBe(true);
    expect(hoch.zvE).toBe(250_000_00 - 10_000_00 - 72_00 - 9756_00);
    expect(hoch.tariflich).toBe(einkommensteuer(hoch.zvE, 2026, true) + 259_00 * 12);
    const niedrig = steuerPrognose({ ...base, gewinn: 30_000_00, angaben: { ...base.angaben, kinder: [{}] } });
    expect(niedrig.kinderfreibetrag).toBe(false);
  });

  it("berücksichtigt Kinderbetreuung, § 35a und Krankheitskosten über der zumutbaren Belastung", () => {
    const p = steuerPrognose({
      ...base,
      angaben: {
        ...base.angaben,
        kinder: [{ kinderbetreuung: 3_000_00 }],
        krankheitskosten: 5_000_00,
        haushaltsnah: { handwerker: 10_000_00, dienstleistungen: 1_000_00 },
      },
    });
    expect(p.kinderbetreuung).toBe(2_400_00);
    // zumutbar mit einem Kind bei 85.000 €: 2 % von 15.340 + 3 % von 35.790 + 4 % von 33.870
    expect(p.aussergewoehnlich).toBe(5_000_00 - Math.floor(15_340_00 * 0.02 + 35_790_00 * 0.03 + 33_870_00 * 0.04));
    expect(p.ermaessigung35a).toBe(1_200_00 + 200_00);
    expect(p.einkommensteuer).toBe(p.tariflich - 1_400_00);
  });

  it("bis 2024 zwei Drittel der Kinderbetreuung, Spenden höchstens 20 %", () => {
    const p = steuerPrognose({
      ...base,
      year: 2024,
      gewinn: 10_000_00,
      angaben: { ...base.angaben, kinder: [{ kinderbetreuung: 9_000_00 }], sonderausgaben: { spenden: 5_000_00 } },
    });
    expect(p.kinderbetreuung).toBe(4_000_00);
    expect(p.sonderausgaben).toBe(2_000_00);
    expect(p.einkommensteuer).toBe(0);
  });

  it("Sonderausgaben-Pauschbetrag deckt die Kinderbetreuung mit ab (§ 10c EStG)", () => {
    const p = steuerPrognose({ ...base, angaben: { ...base.angaben, kinder: [{ kinderbetreuung: 50_00 }] } });
    expect(p.kinderbetreuung).toBe(40_00);
    expect(p.sonderausgaben + p.kinderbetreuung).toBe(72_00);
  });

  it("rechnet den Erstattungsüberhang dem Gesamtbetrag der Einkünfte zu (§ 10 Abs. 4b Satz 3 EStG)", () => {
    // Basisbeiträge 2.500 €, Erstattung und Zuschuss 3.900 €: der Abzug ist 0, der Überhang von 1.400 € erhöht das Einkommen
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: { pkv: 2_000_00, ppv: 500_00, pkvErstattung: 3_000_00, agZuschussKv: 900_00 } },
      },
    });
    expect(p.vorsorge).toBe(0);
    expect(p.erstattungsueberhang).toBe(1_400_00);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00 + 1_400_00);
    expect(p.zvE).toBe(60_000_00 + 1_400_00 - 36_00);
    expect(p.einkommensteuer).toBe(einkommensteuer(p.zvE, 2025));
    // Die Vorauszahlungsseite bildet den Gewinn aus dem Gesamtbetrag; mit dem Überhang muss sie ihn abziehen
    expect(gewinnAusPrognose(p)).toBe(60_000_00);
  });

  it("kennt keinen Überhang, wenn Beiträge und Erstattung gleich hoch sind", () => {
    const gleich = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: { ...base.angaben, vorsorge: { a: { pkv: 2_000_00, ppv: 500_00, pkvErstattung: 2_500_00 } } },
    });
    const ohneVorsorge = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: { ...base.angaben, vorsorge: { a: {} } },
    });
    expect(gleich.vorsorge).toBe(0);
    expect(gleich.erstattungsueberhang).toBe(0);
    expect(gleich.gesamtbetragEinkuenfte).toBe(60_000_00);
    expect(gleich.zvE).toBe(ohneVorsorge.zvE);
    expect(gleich.einkommensteuer).toBe(ohneVorsorge.einkommensteuer);
  });

  it("bleibt unter den Beiträgen beim Abzug, ohne Überhang", () => {
    // 2.500 € Beiträge, 1.000 € Erstattung: 1.500 € bleiben abziehbar, hinzugerechnet wird nichts
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: { ...base.angaben, vorsorge: { a: { pkv: 2_000_00, ppv: 500_00, pkvErstattung: 1_000_00 } } },
    });
    expect(p.vorsorge).toBe(1_500_00);
    expect(p.erstattungsueberhang).toBe(0);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00);
    expect(p.zvE).toBe(60_000_00 - 1_500_00 - 36_00);
    expect(p.einkommensteuer).toBe(einkommensteuer(p.zvE, 2025));
  });

  it("rechnet bei Zusammenveranlagung den Überhang hinzu, der nach der Verrechnung mit dem anderen Ehegatten bleibt", () => {
    // A: 1.000 € Beiträge und 5.000 € Erstattung, Überhang 4.000 €. B: 3.000 € Beiträge.
    // Verrechnet bleibt ein Überhang von 1.000 € (§ 10 Abs. 4b Satz 2 und 3, § 26b EStG), der Abzug ist null.
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: true,
      gewinn: 60_000_00,
      angaben: { ...base.angaben, vorsorge: { a: { pkv: 1_000_00, pkvErstattung: 5_000_00 }, b: { gkv: 3_000_00 } } },
    });
    expect(p.vorsorge).toBe(0);
    expect(p.erstattungsueberhang).toBe(1_000_00);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00 + 1_000_00);
    expect(p.zvE).toBe(60_000_00 + 1_000_00 - 72_00);
  });

  it("rechnet einen Kirchensteuer-Überhang dem Gesamtbetrag der Einkünfte zu (§ 10 Abs. 4b Satz 3 EStG, Nr. 4)", () => {
    // 1.000 € gezahlt, 3.000 € erstattet: der Abzug bleibt bei null, der Überhang von 2.000 € erhöht das Einkommen
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {} },
        sonderausgaben: { kirchensteuerGezahlt: 1_000_00, kirchensteuerErstattet: 3_000_00 },
      },
    });
    expect(p.sonderausgaben).toBe(36_00);
    expect(p.erstattungsueberhang).toBe(2_000_00);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00 + 2_000_00);
    expect(p.zvE).toBe(60_000_00 + 2_000_00 - 36_00);
    expect(p.einkommensteuer).toBe(einkommensteuer(p.zvE, 2025));
    // Die Vorauszahlungsseite rechnet den Gewinn aus dem Gesamtbetrag zurück, der Überhang muss also wieder raus
    expect(gewinnAusPrognose(p)).toBe(60_000_00);
  });

  it("bleibt bei der Kirchensteuer ohne Überhang, wenn die Erstattung unter der Zahlung bleibt", () => {
    // 3.000 € gezahlt, 1.000 € erstattet: 2.000 € bleiben abziehbar, hinzugerechnet wird nichts
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {} },
        sonderausgaben: { kirchensteuerGezahlt: 3_000_00, kirchensteuerErstattet: 1_000_00 },
      },
    });
    expect(p.sonderausgaben).toBe(2_000_00);
    expect(p.erstattungsueberhang).toBe(0);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00);
    expect(p.zvE).toBe(60_000_00 - 2_000_00);
    expect(p.einkommensteuer).toBe(einkommensteuer(p.zvE, 2025));
    expect(gewinnAusPrognose(p)).toBe(60_000_00);
  });

  it("zählt die Lohnkirchensteuer der Bescheinigung nicht mit: der Überhang entsteht (Stand vor #1451)", () => {
    // 200 € Vorauszahlung stehen im Feld, 300 € Kirchensteuer sind erstattet. Die einbehaltene Lohnkirchensteuer von
    // 480 € (Nr. 6 der Bescheinigung) geht in den Steuerabzug, nicht in die Sonderausgaben. § 10 Abs. 1 Nr. 4 EStG
    // meint die im Jahr gezahlte Kirchensteuer, also beides zusammen: Wer die Lohnkirchensteuer im Feld vergisst,
    // bekommt einen Erstattungsüberhang von 100 €, den es nicht gibt. Der Test hält diesen Stand fest; der Hinweis am
    // Feld sagt, was dazugehört (#1451).
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {} },
        arbeitnehmer: { a: { bescheinigungen: [{ brutto: 60_000_00, kirchensteuer: 480_00 }], werbungskosten: {} } },
        sonderausgaben: { kirchensteuerGezahlt: 200_00, kirchensteuerErstattet: 300_00 },
      },
    });
    expect(p.erstattungsueberhang).toBe(100_00);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00 + p.einkuenfteArbeit + 100_00);
  });

  it("bleibt ohne Überhang, wenn die Lohnkirchensteuer im Feld gezahlt steht", () => {
    // Derselbe Fall mit 680 € (= 200 € Vorauszahlung + 480 € Lohnkirchensteuer) im Feld: Der Abzug bleibt positiv,
    // hinzugerechnet wird nichts, obwohl die Bescheinigung dieselbe ist. Das ist der Beweis, den der Hinweis meint.
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: {} },
        arbeitnehmer: { a: { bescheinigungen: [{ brutto: 60_000_00, kirchensteuer: 480_00 }], werbungskosten: {} } },
        sonderausgaben: { kirchensteuerGezahlt: 680_00, kirchensteuerErstattet: 300_00 },
      },
    });
    expect(p.erstattungsueberhang).toBe(0);
    expect(p.sonderausgaben).toBe(380_00);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00 + p.einkuenfteArbeit);
  });

  it("bleibt bei hoher Erstattung ein Überhang, ist er ohne die Lohnkirchensteuer nur zu hoch", () => {
    // Derselbe Fall mit 900 € erstattet: Ohne die Lohnkirchensteuer im Feld rechnet Haben 700 € hinzu, mit ihr
    // 220 €. Der Überhang verschwindet also nicht in jedem Fall, er ist dann nur zu hoch. Der Hinweis sagt beides.
    const angaben = {
      ...base.angaben,
      vorsorge: { a: {} },
      arbeitnehmer: { a: { bescheinigungen: [{ brutto: 60_000_00, kirchensteuer: 480_00 }], werbungskosten: {} } },
      sonderausgaben: { kirchensteuerGezahlt: 200_00, kirchensteuerErstattet: 900_00 },
    };
    const ohne = steuerPrognose({ ...base, year: 2025, zusammen: false, gewinn: 60_000_00, angaben });
    expect(ohne.erstattungsueberhang).toBe(700_00);
    const mit = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: { ...angaben, sonderausgaben: { kirchensteuerGezahlt: 680_00, kirchensteuerErstattet: 900_00 } },
    });
    expect(mit.erstattungsueberhang).toBe(220_00);
    expect(mit.gesamtbetragEinkuenfte).toBe(ohne.gesamtbetragEinkuenfte - 480_00);
  });

  it("rechnet einen Überhang der übrigen Vorsorgeaufwendungen (Nr. 3a) nicht hinzu", () => {
    // Nr. 3a verrechnet nur in sich: ein negativer Betrag dort kürzt den Abzug nicht unter die Basisbeiträge und
    // erhöht den Gesamtbetrag der Einkünfte nicht, § 10 Abs. 4b Satz 3 EStG nennt nur Nr. 3 und Nr. 4.
    const ohneUeberhang = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: { ...base.angaben, vorsorge: { a: { gkv: 3_000_00 } } },
    });
    const mitUeberhang = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: { ...base.angaben, vorsorge: { a: { gkv: 3_000_00 }, sonstige: -2_000_00 } },
    });
    expect(mitUeberhang.vorsorge).toBe(3_000_00);
    expect(mitUeberhang.erstattungsueberhang).toBe(0);
    expect(mitUeberhang.gesamtbetragEinkuenfte).toBe(60_000_00);
    expect(mitUeberhang.zvE).toBe(ohneUeberhang.zvE);
    expect(mitUeberhang.einkommensteuer).toBe(ohneUeberhang.einkommensteuer);
  });

  it("verrechnet bei Zusammenveranlagung den Überhang eines Ehegatten mit den Basisbeiträgen des anderen (§ 26b, § 10 Abs. 4b Satz 2 EStG)", () => {
    // Zusammen veranlagte Ehegatten sind ein Steuerpflichtiger (§ 26b EStG); der Überhang wird zuerst innerhalb der Nr. 3
    // verrechnet, nur der Rest wird hinzugerechnet. BMF vom 24.5.2017, Rz. 130: die Basisbeiträge zählen in der Summe.
    // A: 1.000 € Beiträge, 2.000 € Erstattung. B: 3.000 € Beiträge. Übrige Vorsorge 3.000 €, Höchstbetrag 2 × 2.800 €.
    // Nr. 3 gemeinsam 2.000 €, mit Nr. 3a 5.000 € unter dem Höchstbetrag: Abzug 5.000 €, nichts hinzuzurechnen.
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: true,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: { pkv: 1_000_00, pkvErstattung: 2_000_00 }, b: { gkv: 3_000_00 }, sonstige: 3_000_00 },
      },
    });
    expect(p.erstattungsueberhang).toBe(0);
    expect(p.gesamtbetragEinkuenfte).toBe(60_000_00);
    expect(p.vorsorge).toBe(5_000_00);
    expect(p.zvE).toBe(60_000_00 - 5_000_00 - 72_00);
  });

  it("rechnet das Beispiel aus dem BMF-Schreiben vom 24.5.2017, Rz. 204", () => {
    // KV-Basis 1.200 €, Pflege 300 €, Erstattung KV-Basis 1.600 €: Überhang 400 €, mit der Pflege verrechnet 100 €.
    // Kirchensteuer 200 € gezahlt, 1.500 € erstattet: Überhang 1.300 €. Hinzurechnung 100 € + 1.300 € = 1.400 €.
    const p = steuerPrognose({
      ...base,
      year: 2025,
      zusammen: false,
      gewinn: 60_000_00,
      angaben: {
        ...base.angaben,
        vorsorge: { a: { pkv: 1_200_00, ppv: 300_00, pkvErstattung: 1_600_00 } },
        sonderausgaben: { kirchensteuerGezahlt: 200_00, kirchensteuerErstattet: 1_500_00 },
      },
    });
    expect(p.erstattungsueberhang).toBe(1_400_00);
    expect(p.gesamtbetragEinkuenfte).toBe(61_400_00);
    expect(p.vorsorge).toBe(0);
    expect(p.zvE).toBe(61_400_00 - 36_00);
  });
});
