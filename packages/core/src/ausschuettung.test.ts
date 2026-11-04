import { describe, expect, it } from "vitest";
import { ausEinlagekonto, ausschuettungAnteil, ausschuettungPosting, kapestFrist, steuerabzug } from "./ausschuettung.ts";
import { directBookingsFor, directPosting } from "./posting.ts";

describe("Steuerabzug auf Gewinnausschüttungen", () => {
  it.each([
    // 25 % KapESt, 5,5 % Soli
    [0, { kapest: 250_000, soli: 13_750, kist: 0 }],
    // § 32d Abs. 1 Satz 4 EStG: e / (4 + k) – 10.000 € / 4,09 = 2.444,98 €, KiSt 9 % = 220,04 €, Soli 134,47 €
    [9, { kapest: 244_498, soli: 13_447, kist: 22_004 }],
    // 8 % (Bayern, Baden-Württemberg): 10.000 € / 4,08 = 2.450,98 €
    [8, { kapest: 245_098, soli: 13_480, kist: 19_607 }],
  ] as const)("10.000 € mit Kirchensteuer %i %%", (kirchensteuer, abzug) => {
    expect(steuerabzug(1_000_000, kirchensteuer)).toEqual(abzug);
  });

  it("nichts auf 0 oder negative Erträge", () => {
    expect(steuerabzug(0, 9)).toEqual({ kapest: 0, soli: 0, kist: 0 });
  });

  it("Anteil: aus dem Einlagekonto ohne Abzug, netto ist brutto minus Steuern", () => {
    expect(ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 200_000, kirchensteuer: 0 })).toMatchObject({
      ertrag: 800_000,
      kapest: 200_000,
      soli: 11_000,
      netto: 1_000_000 - 211_000,
    });
  });

  it.each([
    // Ausschüttbarer Gewinn reicht: kein Einlagekonto
    [1_000_000, 2_000_000, 500_000, 0],
    // Übersteigt ihn: Rest aus dem Einlagekonto
    [1_000_000, 700_000, 500_000, 300_000],
    // Höchstens bis zum Bestand
    [1_000_000, 0, 200_000, 200_000],
    // Negativer ausschüttbarer Gewinn zählt als 0
    [1_000_000, -500_000, 2_000_000, 1_000_000],
  ])("§ 27 KStG: Leistung %i, ausschüttbarer Gewinn %i, Einlagekonto %i → %i", (leistung, gewinn, konto, erwartet) => {
    expect(ausEinlagekonto(leistung, gewinn, konto)).toBe(erwartet);
  });
});

describe.each([
  ["SKR03", { vortrag: "0860", gesellschafter: "0730", einbehalt: "1746" }],
  ["SKR04", { vortrag: "2970", gesellschafter: "3510", einbehalt: "3760" }],
] as const)("Buchung der Ausschüttung %s", (kontenrahmen, k) => {
  it("Gewinnvortrag an Gesellschafter (netto) und Einbehaltungen; ausgeglichen", () => {
    const anteile = [
      ausschuettungAnteil({ brutto: 600_000, ausEinlagekonto: 0, kirchensteuer: 9 }),
      ausschuettungAnteil({ brutto: 400_000, ausEinlagekonto: 0, kirchensteuer: 0 }),
    ];
    const lines = ausschuettungPosting(kontenrahmen, anteile);
    const steuern = anteile.reduce((s, a) => s + a.kapest + a.soli + a.kist, 0);
    expect(lines).toEqual([
      { account: k.vortrag, debit: 1_000_000, credit: 0 },
      { account: k.gesellschafter, debit: 0, credit: 1_000_000 - steuern },
      { account: k.einbehalt, debit: 0, credit: steuern },
    ]);
  });

  it("ganz aus dem Einlagekonto: keine Einbehaltung", () => {
    const lines = ausschuettungPosting(kontenrahmen, [ausschuettungAnteil({ brutto: 100_000, ausEinlagekonto: 100_000, kirchensteuer: 9 })]);
    expect(lines.map((l) => l.account)).toEqual([k.vortrag, k.gesellschafter]);
  });
});

describe("Zahlung der einbehaltenen Steuern an das Finanzamt (Bankabgleich)", () => {
  it.each([
    ["SKR03", "1200", "1746"],
    ["SKR04", "1800", "3760"],
  ] as const)("%s: Einbehaltungen an Bank, nur in GmbH und UG", (kontenrahmen, bank, einbehalt) => {
    expect(directBookingsFor("gmbh")).toContain("kapest");
    expect(directBookingsFor("einzelunternehmen")).not.toContain("kapest");
    expect(directPosting("kapest", -137_500, kontenrahmen, "ug")).toEqual([
      { account: bank, debit: 0, credit: 137_500, taxCode: null },
      { account: einbehalt, debit: 137_500, credit: 0, taxCode: null },
    ]);
    expect(() => directPosting("kapest", -100, kontenrahmen, "einzelunternehmen")).toThrow("nur in GmbH und UG");
  });
});

describe("Frist der Kapitalertragsteuer-Anmeldung", () => {
  it.each([
    // 10. Juli 2026 ist ein Freitag
    ["2026-06-30", "2026-07-10"],
    // 10. Januar 2027 ist ein Sonntag: Montag, 11.
    ["2026-12-15", "2027-01-11"],
    // 10. Oktober 2026 ist ein Samstag: Montag, 12.
    ["2026-09-01", "2026-10-12"],
  ])("Zufluss %s: bis %s", (zufluss, frist) => {
    expect(kapestFrist(zufluss, "BY")).toBe(frist);
  });
});
