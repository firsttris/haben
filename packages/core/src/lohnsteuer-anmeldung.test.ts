import { describe, expect, it } from "vitest";
import {
  ersterVollerMonat,
  lstaBereich,
  lstaFrist,
  lstaKennzahlen,
  lstaKennzahlenGleich,
  lstaKey,
  lstaLabel,
  lstaTurnusVorschlag,
  lstaZeitraumAm,
  parseLstaKey,
  turnusFuerJahresbetrag,
  volleMonateImJahr,
  type LstaAbrechnung,
} from "./lohnsteuer-anmeldung.ts";

const ggf = (over: Partial<LstaAbrechnung> = {}): LstaAbrechnung => ({
  mitarbeiter: "a",
  jahr: 2026,
  zahltag: "2026-11-27",
  lohnsteuer: 1_289_33,
  soli: 0,
  kirchensteuer: 116_03,
  konfession: "ev",
  ...over,
});

describe("Anmeldungszeitraum", () => {
  it("Schlüssel, Bezeichnung und Bereich für Monat, Quartal und Kalenderjahr", () => {
    expect(lstaKey({ year: 2026, zeitraum: 3 })).toBe("2026-03");
    expect(lstaKey({ year: 2026, zeitraum: 44 })).toBe("2026-Q4");
    expect(lstaKey({ year: 2026, zeitraum: 19 })).toBe("2026");
    expect(parseLstaKey("2026-Q4")).toEqual({ year: 2026, zeitraum: 44 });
    expect(parseLstaKey("2026")).toEqual({ year: 2026, zeitraum: 19 });
    expect(parseLstaKey("2026-13")).toBeNull();
    expect(parseLstaKey("2026-19")).toBeNull();
    expect(lstaLabel({ year: 2026, zeitraum: 19 })).toBe("Kalenderjahr 2026");
    expect(lstaLabel({ year: 2026, zeitraum: 42 })).toBe("2. Quartal 2026");
    expect(lstaBereich({ year: 2026, zeitraum: 44 })).toEqual({ start: "2026-10-01", end: "2027-01-01" });
    expect(lstaBereich({ year: 2026, zeitraum: 19 })).toEqual({ start: "2026-01-01", end: "2027-01-01" });
    expect(lstaZeitraumAm("2026-05-28", "vierteljaehrlich")).toEqual({ year: 2026, zeitraum: 42 });
    expect(lstaZeitraumAm("2026-05-28", "jaehrlich")).toEqual({ year: 2026, zeitraum: 19 });
  });

  it("Frist am 10. nach Ablauf, am Wochenende oder Feiertag am nächsten Werktag (§ 41a Abs. 1 EStG, § 108 Abs. 3 AO)", () => {
    // 10. Dezember 2026 ist ein Donnerstag
    expect(lstaFrist({ year: 2026, zeitraum: 11 }, "BY")).toBe("2026-12-10");
    // 10. Januar 2027 ist ein Sonntag
    expect(lstaFrist({ year: 2026, zeitraum: 12 }, "BY")).toBe("2027-01-11");
    expect(lstaFrist({ year: 2026, zeitraum: 19 }, "BY")).toBe("2027-01-11");
    expect(lstaFrist({ year: 2026, zeitraum: 43 }, "BY")).toBe("2026-10-12");
  });

  it("Grenzen 1.080 € und 5.000 € (§ 41a Abs. 2 Satz 2 EStG)", () => {
    expect(turnusFuerJahresbetrag(1_080_00)).toBe("jaehrlich");
    expect(turnusFuerJahresbetrag(1_080_01)).toBe("vierteljaehrlich");
    expect(turnusFuerJahresbetrag(5_000_00)).toBe("vierteljaehrlich");
    expect(turnusFuerJahresbetrag(5_000_01)).toBe("monatlich");
  });

  it("Vorjahr, umgerechnet auf ein Jahr, wenn die Betriebsstätte nicht das ganze Jahr bestand (Satz 3)", () => {
    expect(lstaTurnusVorschlag({ year: 2027, vorjahr: { lohnsteuer: 4_000_00, monate: 12 }, ersterVollerMonat: null })?.turnus).toBe("vierteljaehrlich");
    // 4.000 € in 6 Monaten sind 8.000 € im Jahr
    const halb = lstaTurnusVorschlag({ year: 2027, vorjahr: { lohnsteuer: 4_000_00, monate: 6 }, ersterVollerMonat: null });
    expect(halb).toMatchObject({ turnus: "monatlich", jahresbetrag: 8_000_00 });
    expect(halb?.grund).toContain("§ 41a Abs. 2 Satz 3 EStG");
    // 2.500,01 € in 6 Monaten: 5.000,02 € im Jahr, monatlich
    expect(lstaTurnusVorschlag({ year: 2027, vorjahr: { lohnsteuer: 2_500_01, monate: 6 }, ersterVollerMonat: null })?.turnus).toBe("monatlich");
    // 90 € in einem Monat: 1.080 € im Jahr, jährlich
    expect(lstaTurnusVorschlag({ year: 2027, vorjahr: { lohnsteuer: 90_00, monate: 1 }, ersterVollerMonat: null })?.turnus).toBe("jaehrlich");
  });

  it("Erstes Jahr: erster voller Kalendermonat nach der Eröffnung mal zwölf (Satz 4)", () => {
    const v = lstaTurnusVorschlag({ year: 2026, vorjahr: null, ersterVollerMonat: { lohnsteuer: 1_289_33, monat: "2026-11" } });
    expect(v).toMatchObject({ turnus: "monatlich", jahresbetrag: 15_471_96 });
    expect(v?.grund).toContain("November 2026");
    expect(lstaTurnusVorschlag({ year: 2026, vorjahr: null, ersterVollerMonat: { lohnsteuer: 0, monat: "2026-11" } })?.turnus).toBe("jaehrlich");
    expect(lstaTurnusVorschlag({ year: 2026, vorjahr: null, ersterVollerMonat: null })).toBeNull();
    expect(ersterVollerMonat("2026-03-01")).toBe("2026-03");
    expect(ersterVollerMonat("2026-03-15")).toBe("2026-04");
    expect(ersterVollerMonat("2026-12-02")).toBe("2027-01");
    expect(volleMonateImJahr("2025-03-15", 2025)).toBe(9);
    expect(volleMonateImJahr("2025-03-01", 2025)).toBe(10);
    expect(volleMonateImJahr("2024-07-01", 2025)).toBe(12);
    expect(volleMonateImJahr("2025-12-02", 2025)).toBe(0);
  });
});

describe("Kennzahlen", () => {
  const november = { year: 2026, zeitraum: 11 };

  it("Lohnsteuer, Soli und Kirchensteuer im laufenden Jahr, Kz 48 und Kz 83", () => {
    const r = lstaKennzahlen({ zeitraum: november, bundesland: "BY", abrechnungen: [ggf()] });
    expect(r).toEqual({
      ok: true,
      kennzahlen: {
        kz42: { vorjahr: 0, lfdJahr: 1_289_33, folgejahr: 0 },
        kz49: { vorjahr: 0, lfdJahr: 0, folgejahr: 0 },
        kirche: {
          kz61: { vorjahr: 0, lfdJahr: 116_03, folgejahr: 0 },
          kz62: { vorjahr: 0, lfdJahr: 0, folgejahr: 0 },
          kz63: { vorjahr: 0, lfdJahr: 0, folgejahr: 0 },
        },
        kz48: 1_289_33,
        kz83: 1_405_36,
        kz86: 1,
      },
    });
  });

  it("lt und rf sind evangelisch (Kz 61), rk Kz 62, ak Kz 63", () => {
    const r = lstaKennzahlen({
      zeitraum: november,
      bundesland: "NW",
      abrechnungen: [
        ggf({ mitarbeiter: "a", konfession: "lt", kirchensteuer: 100 }),
        ggf({ mitarbeiter: "b", konfession: "rf", kirchensteuer: 200 }),
        ggf({ mitarbeiter: "c", konfession: "rk", kirchensteuer: 300 }),
        ggf({ mitarbeiter: "d", konfession: "ak", kirchensteuer: 400 }),
      ],
    });
    expect(r.ok && r.kennzahlen.kirche.kz61.lfdJahr).toBe(300);
    expect(r.ok && r.kennzahlen.kirche.kz62.lfdJahr).toBe(300);
    expect(r.ok && r.kennzahlen.kirche.kz63.lfdJahr).toBe(400);
    expect(r.ok && r.kennzahlen.kz86).toBe(4);
  });

  it("Minijob mit Pauschsteuer: keine Lohnsteuer in der Anmeldung, zählt aber als Arbeitnehmer (Kz 86)", () => {
    const minijob = ggf({ mitarbeiter: "m", lohnsteuer: 0, soli: 0, kirchensteuer: 0, konfession: null });
    const r = lstaKennzahlen({ zeitraum: november, bundesland: "BY", abrechnungen: [minijob, ggf()] });
    expect(r.ok && r.kennzahlen.kz86).toBe(2);
    expect(r.ok && r.kennzahlen.kz48).toBe(1_289_33);
    const nur = lstaKennzahlen({ zeitraum: november, bundesland: "BY", abrechnungen: [minijob] });
    expect(nur.ok && nur.kennzahlen).toMatchObject({ kz48: 0, kz83: 0, kz86: 1 });
  });

  it("Zahl der Arbeitnehmer zählt jeden Mitarbeiter einmal, auch über mehrere Monate eines Quartals", () => {
    const r = lstaKennzahlen({ zeitraum: { year: 2026, zeitraum: 44 }, bundesland: "BY", abrechnungen: [ggf(), ggf(), ggf({ mitarbeiter: "b" })] });
    expect(r.ok && r.kennzahlen.kz86).toBe(2);
    expect(r.ok && r.kennzahlen.kz42.lfdJahr).toBe(3 * 1_289_33);
  });

  it("Dezember mit Zahltag im Januar: Spalte Vorjahr (§ 38a Abs. 1 Satz 2 EStG)", () => {
    const r = lstaKennzahlen({
      zeitraum: { year: 2027, zeitraum: 1 },
      bundesland: "BY",
      abrechnungen: [ggf({ jahr: 2026, zahltag: "2027-01-21" }), ggf({ jahr: 2027, zahltag: "2027-01-29" })],
    });
    expect(r.ok && r.kennzahlen.kz42).toEqual({ vorjahr: 1_289_33, lfdJahr: 1_289_33, folgejahr: 0 });
    expect(r.ok && r.kennzahlen.kirche.kz61).toEqual({ vorjahr: 116_03, lfdJahr: 116_03, folgejahr: 0 });
    expect(r.ok && r.kennzahlen.kz86).toBe(1);
  });

  it("Vorjahreslohn später als drei Wochen nach Jahresende und Lohn fürs Folgejahr im Voraus: sonstiger Bezug, nicht unterstützt (R 39b.2 LStR)", () => {
    const spaet = lstaKennzahlen({ zeitraum: { year: 2027, zeitraum: 1 }, bundesland: "BY", abrechnungen: [ggf({ jahr: 2026, zahltag: "2027-01-22" })] });
    expect(!spaet.ok && spaet.probleme[0]).toContain("sonstiger Bezug des Jahres 2027");
    const februar = lstaKennzahlen({ zeitraum: { year: 2027, zeitraum: 2 }, bundesland: "BY", abrechnungen: [ggf({ jahr: 2026, zahltag: "2027-02-10" })] });
    expect(februar.ok).toBe(false);
    const quartal = lstaKennzahlen({ zeitraum: { year: 2027, zeitraum: 41 }, bundesland: "BY", abrechnungen: [ggf({ jahr: 2026, zahltag: "2027-01-15" })] });
    expect(quartal.ok && quartal.kennzahlen.kz42.vorjahr).toBe(1_289_33);
    const voraus = lstaKennzahlen({ zeitraum: { year: 2026, zeitraum: 12 }, bundesland: "BY", abrechnungen: [ggf({ jahr: 2027, zahltag: "2026-12-30" })] });
    expect(!voraus.ok && voraus.probleme[0]).toContain("sonstiger Bezug des Jahres 2026");
    expect(lstaKennzahlen({ zeitraum: { year: 2026, zeitraum: 19 }, bundesland: "BY", abrechnungen: [ggf({ jahr: 2024 })] }).ok).toBe(false);
  });

  it("alt-katholische Kirchensteuer in Ländern ohne Kz 63 nicht unterstützt (Regel LStA_LoKi_SN)", () => {
    const r = lstaKennzahlen({ zeitraum: november, bundesland: "SN", abrechnungen: [ggf({ konfession: "ak" })] });
    expect(!r.ok && r.probleme[0]).toContain("Kz 63");
    expect(lstaKennzahlen({ zeitraum: november, bundesland: "SN", abrechnungen: [ggf({ konfession: "rk" })] }).ok).toBe(true);
  });

  it("Vergleich unabhängig von der Reihenfolge der Schlüssel (jsonb)", () => {
    const r = lstaKennzahlen({ zeitraum: november, bundesland: "BY", abrechnungen: [ggf()] });
    if (!r.ok) throw new Error("erwartet ok");
    const { kz86, ...rest } = r.kennzahlen;
    const umsortiert = JSON.parse(JSON.stringify({ kz86, ...rest }));
    expect(lstaKennzahlenGleich(r.kennzahlen, umsortiert)).toBe(true);
    expect(lstaKennzahlenGleich(r.kennzahlen, { ...r.kennzahlen, kz86: 2 })).toBe(false);
  });
});
