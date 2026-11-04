import { describe, expect, it } from "vitest";
import { fehlendeSozialversicherungJahre, SOZIALVERSICHERUNG_JAHRE, type SvBeschaeftigt, type SvEingabe, type SvMinijob, sozialversicherung } from "./index.ts";

/**
 * Erwartungswerte: Wo eine Quelle den Betrag nennt, steht sie am Test. Sonst ist der Wert von Hand aus den Sätzen
 * in `werte.ts` gerechnet (Entgelt × Satz, kaufmännisch auf Cent) und der Rechenweg steht im Kommentar.
 */

/** Gesetzlich versichert mit dem durchschnittlichen Zusatzbeitrag 2026 (2,9 %), U1 1,6 % und U2 0,44 % als Kassensätze */
const ANGESTELLT: SvBeschaeftigt = {
  personengruppe: "beschaeftigt",
  entgelt: 4000_00,
  kv: { art: "gesetzlich", zusatzbeitrag: 290 },
  pflege: { kinderlosenzuschlag: false, kinderUnter25: 1 },
  sachsen: false,
  umlagen: { u1: 160, u2: 44 },
};

const MINIJOB: SvMinijob = {
  personengruppe: "minijob",
  entgelt: 603_00,
  gesetzlichKrankenversichert: true,
  rvBefreit: false,
  pauschsteuer: true,
  u1: true,
};

function rechne(eingabe: SvEingabe) {
  const r = sozialversicherung(2026, eingabe);
  if (!r.ok) throw new Error(r.meldung);
  return r;
}

describe("sozialversicherung, Jahressperre", () => {
  it("rechnet nur Jahre mit hinterlegten Werten, nie mit denen des Vorjahres", () => {
    expect(SOZIALVERSICHERUNG_JAHRE).toEqual([2026]);
    expect(sozialversicherung(2027, ANGESTELLT)).toEqual({
      ok: false,
      grund: "nicht-hinterlegt",
      meldung: "Die Sozialversicherungswerte 2027 sind noch nicht hinterlegt.",
    });
    expect(sozialversicherung(2025, ANGESTELLT).ok).toBe(false);
  });

  it("verlangt ab Dezember die Werte des Folgejahres", () => {
    expect(fehlendeSozialversicherungJahre(new Date(2026, 10, 30))).toEqual([]);
    expect(fehlendeSozialversicherungJahre(new Date(2026, 11, 1))).toEqual([2027]);
    expect(fehlendeSozialversicherungJahre(new Date(2027, 0, 2))).toEqual([2027]);
  });

  // Liest das echte Datum: Ab Dezember schlägt er fehl, bis die Werte des nächsten Jahres hinterlegt sind
  // (docs/entwicklung.md, Abschnitt „Sozialversicherung: Werte jährlich aktualisieren“).
  it("Jahreswechsel (echtes Datum): Werte für dieses und ab Dezember das nächste Jahr sind hinterlegt", () => {
    expect(fehlendeSozialversicherungJahre(new Date())).toEqual([]);
  });
});

describe("sozialversicherungspflichtig beschäftigt", () => {
  it("teilt KV, PV, RV und AV je zur Hälfte und rechnet die Umlagen vom RV-Entgelt", () => {
    // 4.000 € × 7,3 %, × 1,45 % (halber Zusatzbeitrag), × 1,8 %, × 9,3 %, × 1,3 %; Umlagen 1,6 %, 0,44 %, 0,15 %
    expect(rechne(ANGESTELLT)).toEqual({
      ok: true,
      personengruppe: "beschaeftigt",
      bemessung: { kvPv: 4000_00, rvAv: 4000_00, arbeitnehmer: null },
      kv: { an: 292_00, ag: 292_00 },
      kvZusatz: { an: 58_00, ag: 58_00 },
      pv: { an: 72_00, ag: 72_00 },
      rv: { an: 372_00, ag: 372_00 },
      av: { an: 52_00, ag: 52_00 },
      umlagen: { u1: 64_00, u2: 17_60, insolvenzgeld: 6_00 },
      pauschsteuer: 0,
      arbeitnehmer: 846_00,
      arbeitgeber: 933_60,
    });
  });

  it("deckelt KV und PV an der BBG von 5.812,50 €, RV und AV an 8.450 €", () => {
    // PV-Höchstbeitrag je Seite 104,63 € (IKK classic, Rechengrößen 01/2026: Zuschuss PV bundesweit 104,63 €)
    const ueber = rechne({ ...ANGESTELLT, entgelt: 6000_00 });
    expect(ueber.bemessung).toEqual({ kvPv: 5812_50, rvAv: 6000_00, arbeitnehmer: null });
    expect(ueber.kv).toEqual({ an: 424_31, ag: 424_31 }); // 5.812,50 € × 7,3 % = 424,3125 €
    expect(ueber.kvZusatz).toEqual({ an: 84_28, ag: 84_28 }); // 5.812,50 € × 1,45 % = 84,28125 €
    expect(ueber.pv).toEqual({ an: 104_63, ag: 104_63 });
    expect(ueber.rv.an).toBe(558_00);
    const weitUeber = rechne({ ...ANGESTELLT, entgelt: 9000_00 });
    expect(weitUeber.bemessung.rvAv).toBe(8450_00);
    expect(weitUeber.rv).toEqual({ an: 785_85, ag: 785_85 }); // 8.450 € × 9,3 %
    expect(weitUeber.av).toEqual({ an: 109_85, ag: 109_85 }); // 8.450 € × 1,3 %
    expect(weitUeber.umlagen).toEqual({ u1: 135_20, u2: 37_18, insolvenzgeld: 12_68 }); // 12,675 € → 12,68 €
    // Genau an der Grenze wie darüber
    expect(rechne({ ...ANGESTELLT, entgelt: 5812_50 }).kv).toEqual(ueber.kv);
    expect(rechne({ ...ANGESTELLT, entgelt: 8450_00 }).rv).toEqual(weitUeber.rv);
  });

  it("rechnet den Zusatzbeitrag der Kasse getrennt, auch mit ungeradem Satz", () => {
    // 4.000 € × 2,45 % / 2 = 49,00 €; 3.333,33 € × 7,3 % = 243,333 € und × 1,225 % = 40,833 € (zusammen gerechnet
    // wären es 284,17 € statt 243,33 € + 40,83 €)
    expect(rechne({ ...ANGESTELLT, kv: { art: "gesetzlich", zusatzbeitrag: 245 } }).kvZusatz).toEqual({ an: 49_00, ag: 49_00 });
    const krumm = rechne({ ...ANGESTELLT, entgelt: 3333_33, kv: { art: "gesetzlich", zusatzbeitrag: 245 } });
    expect([krumm.kv.an, krumm.kvZusatz.an]).toEqual([243_33, 40_83]);
  });

  it("rechnet privat Versicherte ohne KV und PV", () => {
    const r = rechne({ ...ANGESTELLT, kv: { art: "privat" } });
    expect(r.kv).toEqual({ an: 0, ag: 0 });
    expect(r.kvZusatz).toEqual({ an: 0, ag: 0 });
    expect(r.pv).toEqual({ an: 0, ag: 0 });
    expect(r.rv.an).toBe(372_00);
  });

  it("rechnet einen Monat ohne Entgelt mit null", () => {
    expect(rechne({ ...ANGESTELLT, entgelt: 0 }).arbeitgeber).toBe(0);
  });
});

describe("Pflegeversicherung", () => {
  // Sätze: TK und AOK, Beitragssätze 2026; DRV summa summarum „Beitragstragung“ (Sachsen 2,3 % / 1,3 %, kinderlos 2,9 %)
  it.each([
    ["kinderlos", { kinderlosenzuschlag: true, kinderUnter25: 0 }, false, { an: 96_00, ag: 72_00 }], // 2,4 % / 1,8 %
    ["ohne Kinder unter 23", { kinderlosenzuschlag: false, kinderUnter25: 0 }, false, { an: 72_00, ag: 72_00 }],
    ["zwei Kinder unter 25", { kinderlosenzuschlag: false, kinderUnter25: 2 }, false, { an: 62_00, ag: 72_00 }], // 1,55 %
    ["drei Kinder unter 25", { kinderlosenzuschlag: false, kinderUnter25: 3 }, false, { an: 52_00, ag: 72_00 }], // 1,3 %
    ["sechs Kinder unter 25 (höchstens vier Abschläge)", { kinderlosenzuschlag: false, kinderUnter25: 6 }, false, { an: 32_00, ag: 72_00 }], // 0,8 %
    ["Sachsen", { kinderlosenzuschlag: false, kinderUnter25: 1 }, true, { an: 92_00, ag: 52_00 }], // 2,3 % / 1,3 %
    ["Sachsen kinderlos", { kinderlosenzuschlag: true, kinderUnter25: 0 }, true, { an: 116_00, ag: 52_00 }], // 2,9 % / 1,3 %
    ["Sachsen mit drei Kindern", { kinderlosenzuschlag: false, kinderUnter25: 3 }, true, { an: 72_00, ag: 52_00 }], // 1,8 % / 1,3 %
  ] as const)("%s", (_, pflege, sachsen, pv) => {
    expect(rechne({ ...ANGESTELLT, pflege, sachsen }).pv).toEqual(pv);
  });

  it("deckelt Sachsen an der BBG", () => {
    // Arbeitgeber 5.812,50 € × 1,3 % = 75,56 € (IKK classic, Rechengrößen 01/2026: Zuschuss PV Sachsen 75,56 €)
    expect(rechne({ ...ANGESTELLT, entgelt: 7000_00, sachsen: true }).pv).toEqual({ an: 133_69, ag: 75_56 });
  });
});

describe("Übergangsbereich (Midijob)", () => {
  it("rechnet Beispiel 7 des TK-Beratungsblatts zum Übergangsbereich (03/2026) nach", () => {
    // TK, „Beschäftigungen im Übergangs-/Midijobbereich“, Stand 03/2026, Beispiel 7 (Frau Meier, 1.000 €, TK-Zusatzbeitrag
    // 2,69 %, kinderlos): https://www.tk.de/resource/blob/2031420/c5924456e673ed942a4be369a4ad070f/beratungsblatt-beschaeftigung-im-uebergangs-midijobbereich-data.pdf
    const r = rechne({
      ...ANGESTELLT,
      entgelt: 1000_00,
      kv: { art: "gesetzlich", zusatzbeitrag: 269 },
      pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 },
    });
    expect(r.bemessung).toEqual({ kvPv: 854_06, rvAv: 854_06, arbeitnehmer: 568_36 });
    expect(r.kv).toEqual({ an: 41_49, ag: 83_21 }); // Gesamt 124,70 €
    expect(r.kvZusatz).toEqual({ an: 7_64, ag: 15_34 }); // Gesamt 22,98 €
    expect(r.pv).toEqual({ an: 10_23 + 5_12, ag: 20_51 }); // PV 30,74 €, Zuschlag 5,12 € allein beim AN
    expect(r.rv).toEqual({ an: 52_86, ag: 106_00 }); // Gesamt 158,86 €
    expect(r.av).toEqual({ an: 7_39, ag: 14_81 }); // Gesamt 22,20 €
    // Summen der Tabelle: Gesamt 364,60 €, AG 239,87 €, AN 124,73 €
    expect(r.arbeitnehmer).toBe(124_73);
    expect(r.arbeitgeber - r.umlagen.u1 - r.umlagen.u2 - r.umlagen.insolvenzgeld).toBe(239_87);
  });

  it("rechnet 1.200 € wie die Midijob-Rechner und die Umlagen von der reduzierten Einnahme", () => {
    // 1.200 €: BE 1.083,25 €, BE-AN 854,69 €; RV 79,49 € / 121,99 € (Midijob-Rechner 2026 von smart-rechner.de);
    // übrige Zweige nach § 2 Abs. 2 BVV wie im TK-Beispiel. Umlagen vom Gesamtbetrag (§ 358 Abs. 2 SGB III).
    expect(rechne({ ...ANGESTELLT, entgelt: 1200_00 })).toEqual({
      ok: true,
      personengruppe: "beschaeftigt",
      bemessung: { kvPv: 1083_25, rvAv: 1083_25, arbeitnehmer: 854_69 },
      kv: { an: 62_39, ag: 95_77 },
      kvZusatz: { an: 12_39, ag: 19_03 },
      pv: { an: 15_38, ag: 23_62 },
      rv: { an: 79_49, ag: 121_99 },
      av: { an: 11_11, ag: 17_05 },
      umlagen: { u1: 17_33, u2: 4_77, insolvenzgeld: 1_62 },
      pauschsteuer: 0,
      arbeitnehmer: 180_76,
      arbeitgeber: 301_18,
    });
  });

  it("schlägt den Kinderlosenzuschlag aus der Gesamteinnahme auf den Arbeitnehmeranteil", () => {
    // § 2 Abs. 2 Satz 6 BVV: Zuschlag auf die Einnahme nach § 20 Abs. 2a Satz 1 SGB IV, wie im TK-Beispiel 7;
    // 1.083,25 € × 0,6 % = 6,4995 € → 6,50 €; AN 15,38 € + 6,50 € = 21,88 €
    expect(rechne({ ...ANGESTELLT, entgelt: 1200_00, pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 } }).pv).toEqual({ an: 21_88, ag: 23_62 });
  });

  it("zieht Kinderabschläge aus der Arbeitnehmereinnahme ab", () => {
    // § 2 Abs. 2 Satz 7 BVV: drei Kinder = 0,5 Punkte auf 854,69 € = 4,27 €; AN 15,38 € − 4,27 €, AG unverändert
    expect(rechne({ ...ANGESTELLT, entgelt: 1200_00, pflege: { kinderlosenzuschlag: false, kinderUnter25: 3 } }).pv).toEqual({ an: 11_11, ag: 23_62 });
  });

  it("beginnt einen Cent über der Geringfügigkeitsgrenze von 603 €", () => {
    // 603,01 €: Gesamt 0,6619 × 603 € + 1,1459… × 0,01 € = 399,14 €, AN 2.000 / 1.397 × 0,01 € = 0,01 €
    const r = rechne({ ...ANGESTELLT, entgelt: 603_01 });
    expect(r.bemessung).toEqual({ kvPv: 399_14, rvAv: 399_14, arbeitnehmer: 1 });
    expect(r.rv).toEqual({ an: 0, ag: 74_24 }); // 0,01 € × 9,3 % rundet auf 0; 2 × 37,12 €
    expect(r.arbeitnehmer).toBe(0);
  });

  it("endet bei 2.000 € mit vollen Anteilen und rechnet ab 2.000,01 € regulär", () => {
    const oben = rechne({ ...ANGESTELLT, entgelt: 2000_00 });
    expect(oben.bemessung).toEqual({ kvPv: 2000_00, rvAv: 2000_00, arbeitnehmer: 2000_00 });
    expect(oben.rv).toEqual({ an: 186_00, ag: 186_00 });
    const darueber = rechne({ ...ANGESTELLT, entgelt: 2000_01 });
    expect(darueber.bemessung).toEqual({ kvPv: 2000_01, rvAv: 2000_01, arbeitnehmer: null });
    expect(darueber.rv).toEqual({ an: 186_00, ag: 186_00 });
  });

  it("lehnt Sachsen ab, weil die Aufteilung nicht mit einem Rechenbeispiel belegt ist", () => {
    expect(sozialversicherung(2026, { ...ANGESTELLT, entgelt: 1200_00, sachsen: true })).toEqual({
      ok: false,
      grund: "nicht-unterstuetzt",
      meldung: "Sozialversicherung mit Pflegeversicherung in Sachsen im Übergangsbereich ist nicht unterstützt.",
    });
    expect(sozialversicherung(2026, { ...ANGESTELLT, entgelt: 2500_00, sachsen: true }).ok).toBe(true);
    expect(sozialversicherung(2026, { ...ANGESTELLT, entgelt: 1200_00, sachsen: true, kv: { art: "privat" } }).ok).toBe(true);
  });
});

describe("Minijob (gewerblich)", () => {
  it("rechnet die Abgaben an der Grenze von 603 €", () => {
    // 603 €: KV 13 % = 78,39 €, RV 15 % = 90,45 €, Pauschsteuer 2 % = 12,06 €, AN 3,6 % = 21,71 €
    // U1 0,8 % = 4,82 €, U2 0,22 % = 1,33 €, Insolvenzgeld 0,15 % = 0,90 €; zusammen 187,95 €. Sätze und Obergrenze
    // 31,17 % aus der Tabelle der Minijob-Zentrale, Abgaben & Steuern für Gewerbetreibende
    // (https://www.minijob-zentrale.de/DE/fuer-gewerbetreibende/abgaben-und-steuern/abgaben-und-steuern_node.html)
    expect(rechne(MINIJOB)).toEqual({
      ok: true,
      personengruppe: "minijob",
      bemessung: { kvPv: 603_00, rvAv: 603_00, arbeitnehmer: null },
      kv: { an: 0, ag: 78_39 },
      kvZusatz: { an: 0, ag: 0 },
      pv: { an: 0, ag: 0 },
      rv: { an: 21_71, ag: 90_45 },
      av: { an: 0, ag: 0 },
      umlagen: { u1: 4_82, u2: 1_33, insolvenzgeld: 90 },
      pauschsteuer: 12_06,
      arbeitnehmer: 21_71,
      arbeitgeber: 187_95,
    });
  });

  it("rechnet den RV-Anteil unter 175 € aus der Mindestbemessung", () => {
    // Minijob-Zentrale, FAQ „Kann ich von jedem noch so kleinen Gehalt in die Rentenversicherung einzahlen?“: 150 € →
    // Mindestbeitrag 32,55 €, AG 22,50 €, AN 10,05 € (§ 2 Abs. 1 Satz 5 BVV)
    // https://www.minijob-zentrale.de/DE/meta/faq-bereich/rentenversicherung/54_kann_ich_von_kleinem_gehalt_in_rv_einzahlen/faq_54_kann_ich_von_kleinem_gehalt_in_rv_einzahlen.html
    expect(rechne({ ...MINIJOB, entgelt: 150_00 }).rv).toEqual({ an: 10_05, ag: 22_50 });
    const r = rechne({ ...MINIJOB, entgelt: 100_00 });
    expect(r.rv).toEqual({ an: 17_55, ag: 15_00 }); // 32,55 € − 15,00 €
    expect(r.bemessung.rvAv).toBe(175_00);
    expect(rechne({ ...MINIJOB, entgelt: 175_00 }).rv).toEqual({ an: 6_30, ag: 26_25 }); // 3,6 % / 15 %
  });

  it("lässt den Anteil des Beschäftigten bei RV-Befreiung weg und ohne gesetzliche KV die Pauschale", () => {
    const r = rechne({ ...MINIJOB, rvBefreit: true, gesetzlichKrankenversichert: false, pauschsteuer: false, u1: false });
    expect(r.rv).toEqual({ an: 0, ag: 90_45 });
    expect(r.kv).toEqual({ an: 0, ag: 0 });
    expect(r.umlagen).toEqual({ u1: 0, u2: 1_33, insolvenzgeld: 90 });
    expect(r.pauschsteuer).toBe(0);
    expect(rechne({ ...MINIJOB, entgelt: 100_00, rvBefreit: true }).rv).toEqual({ an: 0, ag: 15_00 });
  });

  it("lehnt Entgelt über 603 € ab", () => {
    expect(sozialversicherung(2026, { ...MINIJOB, entgelt: 603_01 })).toEqual({
      ok: false,
      grund: "ungueltig",
      meldung: "Ein Minijob endet bei 603,00 € im Monat.",
    });
  });
});

describe("Gesellschafter-Geschäftsführer ohne SV-Pflicht", () => {
  it("zahlt keine Beiträge und keine Umlagen", () => {
    const r = rechne({ personengruppe: "ggf", entgelt: 8000_00 });
    expect([r.kv, r.kvZusatz, r.pv, r.rv, r.av]).toEqual(Array(5).fill({ an: 0, ag: 0 }));
    expect(r.umlagen).toEqual({ u1: 0, u2: 0, insolvenzgeld: 0 });
    expect([r.arbeitnehmer, r.arbeitgeber]).toEqual([0, 0]);
  });
});

describe("nicht unterstützte und ungültige Eingaben", () => {
  it.each([
    ["mehrfachbeschaeftigung", { mehrfachbeschaeftigung: true }, "Mehrfachbeschäftigung"],
    ["kurzfristig", { kurzfristig: true }, "kurzfristige Beschäftigung"],
    ["auszubildend", { auszubildend: true }, "Auszubildende"],
    ["privathaushalt", { privathaushalt: true }, "Minijob im Privathaushalt"],
    ["einmalzahlung", { einmalzahlung: 500_00 }, "Einmalzahlung"],
    ["svTage", { svTage: 15 }, "Teilmonat"],
  ] as const)("lehnt %s ab, statt zu rechnen", (_, zusatz, text) => {
    expect(sozialversicherung(2026, { ...ANGESTELLT, ...zusatz })).toEqual({
      ok: false,
      grund: "nicht-unterstuetzt",
      meldung: `Sozialversicherung mit ${text} ist nicht unterstützt.`,
    });
  });

  it("rechnet mit neutralen Werten wie ohne sie", () => {
    const neutral = { mehrfachbeschaeftigung: false, kurzfristig: false, auszubildend: false, privathaushalt: false, einmalzahlung: 0, svTage: 30 };
    expect(sozialversicherung(2026, { ...ANGESTELLT, ...neutral })).toEqual(sozialversicherung(2026, ANGESTELLT));
    const zwei = sozialversicherung(2026, { ...MINIJOB, mehrfachbeschaeftigung: true, kurzfristig: true });
    expect(zwei.ok === false && zwei.meldung).toBe("Sozialversicherung mit Mehrfachbeschäftigung, kurzfristige Beschäftigung ist nicht unterstützt.");
  });

  it.each([
    ["Cent-Bruchteile", { entgelt: 100.5 }, "Das Entgelt muss ein ganzer, nicht negativer Betrag in Cent sein."],
    ["negatives Entgelt", { entgelt: -1 }, "Das Entgelt muss ein ganzer, nicht negativer Betrag in Cent sein."],
    [
      "Zusatzbeitrag in Prozent",
      { kv: { art: "gesetzlich", zusatzbeitrag: 2.9 } },
      "Der Zusatzbeitrag muss ein ganzer, nicht negativer Satz in Basispunkten sein.",
    ],
    ["negative Umlage", { umlagen: { u1: null, u2: -1 } }, "Die Umlagesätze müssen ganze, nicht negative Sätze in Basispunkten sein."],
    ["Zuschlag trotz Kind", { pflege: { kinderlosenzuschlag: true, kinderUnter25: 1 } }, "Mit Kindern fällt kein Zuschlag für Kinderlose an."],
    ["halbe Kinder", { pflege: { kinderlosenzuschlag: false, kinderUnter25: 1.5 } }, "Die Zahl der Kinder unter 25 muss eine ganze, nicht negative Zahl sein."],
    ["31 SV-Tage", { svTage: 31 }, "Die SV-Tage müssen eine ganze Zahl von 1 bis 30 sein."],
  ])("lehnt %s ab", (_, zusatz, meldung) => {
    expect(sozialversicherung(2026, { ...ANGESTELLT, ...(zusatz as Partial<SvBeschaeftigt>) })).toEqual({ ok: false, grund: "ungueltig", meldung });
  });

  // Ein einzelner Monat bis 603 € in einer versicherungspflichtigen Beschäftigung ist kein Minijob: Er wird nach § 2 Abs. 2
  // Satz 2 und 5 BVV mit F × Entgelt bemessen (TK-Beratungsblatt 03/2026, Beispiel 6). Dafür braucht es das regelmäßige
  // Entgelt aus der Lohnabrechnung; bis dahin nicht rechnen und nicht auf die Pauschalen des Minijobs verweisen.
  it.each([1, 510_00, 603_00])("rechnet einen Monat mit %i Cent in versicherungspflichtiger Beschäftigung nicht", (entgelt) => {
    const ergebnis = sozialversicherung(2026, { ...ANGESTELLT, entgelt });
    expect(ergebnis).toMatchObject({ ok: false, grund: "nicht-unterstuetzt" });
    expect(ergebnis.ok === false && ergebnis.meldung).not.toMatch(/Minijob/);
  });

  it("rechnet U1 nur, wenn der Arbeitgeber teilnimmt", () => {
    expect(rechne({ ...ANGESTELLT, umlagen: { u1: null, u2: 44 } }).umlagen).toEqual({ u1: 0, u2: 17_60, insolvenzgeld: 6_00 });
  });
});
