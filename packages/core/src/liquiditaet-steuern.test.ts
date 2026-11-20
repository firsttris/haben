import { describe, expect, it } from "vitest";
import type { DauerfristSetting } from "./dauerfrist.ts";
import type { LiquiditaetsPosten } from "./liquiditaet.ts";
import {
  gewerbesteuertermine,
  offeneUstZeitraeume,
  sondervorauszahlungsPosten,
  umsatzsteuerPosten,
  vorauszahlungsPosten,
  vorauszahlungsTermineZwischen,
} from "./liquiditaet-steuern.ts";
import type { VatFrequencySetting } from "./voranmeldungszeitraum.ts";

const HEUTE = "2026-11-20";
const MONATLICH: VatFrequencySetting[] = [{ year: 2026, fromMonth: 1, frequency: "monatlich" }];
const QUARTAL: VatFrequencySetting[] = [{ year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" }];
const DAUERFRIST: DauerfristSetting[] = [{ year: 2026, active: true, sondervorauszahlung: 110_000 }];

describe("Termine der Vorauszahlungen", () => {
  it("Gewerbesteuer am 15. Februar, Mai, August und November, verschoben auf den nächsten Werktag", () => {
    // 15.05.2027 ist ein Samstag, der Montag danach Pfingstmontag; 15.08.2027 ein Sonntag
    expect(gewerbesteuertermine(2027, "BW")).toEqual(["2027-02-15", "2027-05-18", "2027-08-16", "2027-11-15"]);
    // Mariä Himmelfahrt ist nur im Saarland landesweit Feiertag
    expect(gewerbesteuertermine(2025, "SL")[2]).toBe("2025-08-18");
    expect(gewerbesteuertermine(2025, "BW")[2]).toBe("2025-08-15");
  });

  it("Einkommen- und Körperschaftsteuer mit Soli und Kirchensteuer am 10. des letzten Quartalsmonats, über den Jahreswechsel", () => {
    expect(vorauszahlungsTermineZwischen("est", HEUTE, "2027-11-19", "BW")).toEqual(["2026-12-10", "2027-03-10", "2027-06-10", "2027-09-10"]);
    expect(vorauszahlungsTermineZwischen("kst", HEUTE, "2027-03-10", "BW")).toEqual(["2026-12-10", "2027-03-10"]);
    expect(vorauszahlungsTermineZwischen("soli", HEUTE, "2026-12-31", "BW")).toEqual(["2026-12-10"]);
    expect(vorauszahlungsTermineZwischen("gewst", HEUTE, "2027-05-19", "BW")).toEqual(["2027-02-15", "2027-05-18"]);
  });
});

describe("Vorauszahlungen fortschreiben", () => {
  const basis = {
    art: "est" as const,
    betrag: 120_000,
    heute: HEUTE,
    bis: "2027-05-19",
    bundesland: "BW" as const,
    text: "Einkommensteuer",
    quelleId: "z1",
    privat: true,
  };

  it("die letzte Zahlung am nächsten Termin und danach, als erwartet und privat", () => {
    const liste = vorauszahlungsPosten({ ...basis, letzteZahlung: "2026-09-10", sicherheit: "erwartet" });
    expect(liste.map((p) => p.datum)).toEqual(["2026-12-10", "2027-03-10"]);
    expect(liste[0]).toMatchObject({ betrag: 120_000, richtung: "aus", sicherheit: "erwartet", privat: true, quelle: { art: "vorauszahlung", id: "z1" } });
  });

  it("eine Zahlung kurz vor dem Termin deckt ihn ab", () => {
    const liste = vorauszahlungsPosten({ ...basis, letzteZahlung: "2026-12-01", sicherheit: "erwartet" });
    expect(liste.map((p) => p.datum)).toEqual(["2027-03-10"]);
  });

  it("ohne Zahlung ab heute geschätzt, ohne Betrag nichts", () => {
    expect(vorauszahlungsPosten({ ...basis, letzteZahlung: null, sicherheit: "geschaetzt", privat: false }).map((p) => [p.datum, p.privat])).toEqual([
      ["2026-12-10", undefined],
      ["2027-03-10", undefined],
    ]);
    expect(vorauszahlungsPosten({ ...basis, betrag: 0, letzteZahlung: null, sicherheit: "geschaetzt" })).toEqual([]);
  });
});

describe("Offene Voranmeldungszeiträume", () => {
  const basis = { bis: "2027-02-18", abgegeben: [], bundesland: "BW" as const, dauerfrist: [] };

  it("monatlich ohne Dauerfrist: der 10. des Folgemonats, verschoben auf den Werktag", () => {
    const liste = offeneUstZeitraeume({ ...basis, ab: { year: 2026, month: 10 }, frequencies: MONATLICH, abgegeben: [{ year: 2026, month: 10 }] });
    // 10.01.2027 ist ein Sonntag
    expect(liste.map((z) => [z.zeitraum.month, z.faellig, z.von, z.bis])).toEqual([
      [11, "2026-12-10", "2026-11-01", "2026-12-01"],
      [12, "2027-01-11", "2026-12-01", "2027-01-01"],
      [1, "2027-02-10", "2027-01-01", "2027-02-01"],
    ]);
  });

  it("monatlich mit Dauerfrist einen Monat später", () => {
    const liste = offeneUstZeitraeume({ ...basis, ab: { year: 2026, month: 11 }, frequencies: MONATLICH, dauerfrist: DAUERFRIST });
    expect(liste.map((z) => [z.zeitraum.month, z.faellig])).toEqual([
      [11, "2027-01-11"],
      [12, "2027-02-10"],
    ]);
  });

  it("vierteljährlich, mit und ohne Dauerfrist", () => {
    const ohne = offeneUstZeitraeume({ ...basis, ab: { year: 2026, month: 10 }, frequencies: QUARTAL });
    expect(ohne.map((z) => [z.zeitraum.month, z.faellig, z.von, z.bis])).toEqual([[44, "2027-01-11", "2026-10-01", "2027-01-01"]]);
    const mit = offeneUstZeitraeume({
      ...basis,
      ab: { year: 2026, month: 10 },
      frequencies: QUARTAL,
      dauerfrist: [{ year: 2026, active: true, sondervorauszahlung: null }],
    });
    expect(mit.map((z) => z.faellig)).toEqual(["2027-02-10"]);
  });

  it("ohne Voranmeldung kein Zeitraum", () => {
    expect(offeneUstZeitraeume({ ...basis, ab: { year: 2026, month: 10 }, frequencies: [{ year: 2026, fromMonth: 1, frequency: "keine" }] })).toEqual([]);
  });
});

describe("Umsatzsteuer aus den Posten", () => {
  const zeitraum = { zeitraum: { year: 2026, month: 11 }, von: "2026-11-01", bis: "2026-12-01", faellig: "2026-12-10" };
  const p = (datum: string, steuer: number): LiquiditaetsPosten => ({
    datum,
    betrag: 1,
    richtung: "ein",
    text: "",
    quelle: { art: "rechnung", id: datum },
    sicherheit: "erwartet",
    steuer: { betrag: steuer, datum },
  });

  it("gebucht plus die Steuer der erwarteten Posten im Zeitraum, als geschätzter Ausgang am Fälligkeitstag", () => {
    // Ist: Steuer am erwarteten Zahlungseingang 25.11. zählt, die vom 01.12. gehört in den Dezember
    const liste = umsatzsteuerPosten([{ ...zeitraum, gebucht: 50_000 }], [p("2026-11-25", 19_000), p("2026-12-01", 38_000), { ...p("2026-11-28", -4_000) }]);
    expect(liste).toEqual([
      {
        datum: "2026-12-10",
        betrag: 65_000,
        richtung: "aus",
        text: "Umsatzsteuer November 2026",
        quelle: { art: "umsatzsteuer", id: "2026-11" },
        sicherheit: "geschaetzt",
      },
    ]);
  });

  it("ein Überschuss der Vorsteuer kommt als Erstattung, null ergibt keinen Posten", () => {
    expect(umsatzsteuerPosten([{ ...zeitraum, gebucht: -10_000 }], [])[0]).toMatchObject({ betrag: 10_000, richtung: "ein" });
    expect(umsatzsteuerPosten([{ ...zeitraum, gebucht: 0 }], [p("2026-12-05", 1_000)])).toEqual([]);
  });
});

describe("Sondervorauszahlung", () => {
  const basis = { heute: HEUTE, bis: "2027-05-19", frequencies: MONATLICH, gezahlt: new Set<number>(), bundesland: "BW" as const };

  it("am 10. Februar, geschätzt aus dem Vorjahr, solange für das Jahr keine angemeldet ist", () => {
    expect(sondervorauszahlungsPosten({ ...basis, dauerfrist: DAUERFRIST })).toEqual([
      {
        datum: "2027-02-10",
        betrag: 110_000,
        richtung: "aus",
        text: "Sondervorauszahlung 2027",
        quelle: { art: "sondervorauszahlung", id: "2027" },
        sicherheit: "geschaetzt",
      },
    ]);
  });

  it("angemeldet fest; gezahlt, vierteljährlich oder ohne Dauerfrist keine", () => {
    const angemeldet = [...DAUERFRIST, { year: 2027, active: true, sondervorauszahlung: 130_000 }];
    expect(sondervorauszahlungsPosten({ ...basis, dauerfrist: angemeldet })[0]).toMatchObject({ betrag: 130_000, sicherheit: "fest" });
    expect(sondervorauszahlungsPosten({ ...basis, dauerfrist: angemeldet, gezahlt: new Set([2027]) })).toEqual([]);
    expect(sondervorauszahlungsPosten({ ...basis, dauerfrist: DAUERFRIST, frequencies: QUARTAL })).toEqual([]);
    expect(sondervorauszahlungsPosten({ ...basis, dauerfrist: [...DAUERFRIST, { year: 2027, active: false, sondervorauszahlung: null }] })).toEqual([]);
  });
});
