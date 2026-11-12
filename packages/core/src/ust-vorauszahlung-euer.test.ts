import { describe, expect, it } from "vitest";
import { dueDate, gesetzlicheFaelligkeit } from "./period.ts";
import { ustVorauszahlungImVorjahr } from "./ust-vorauszahlung-euer.ts";

const DEZ = { year: 2026, month: 12 };
const zahlung = (buchungstag: string, zeitraum = DEZ, dauerfrist = false, abfluss = true) =>
  ustVorauszahlungImVorjahr({ buchungstag, zeitraum, dauerfrist, abfluss });

describe("gesetzlicheFaelligkeit", () => {
  it("10. nach Ablauf des Zeitraums, ohne § 108 Abs. 3 AO; dueDate verschiebt auf den Werktag", () => {
    // 10.01.2027 ist ein Sonntag (BFH X R 44/16: für § 11 EStG zählt der 10.)
    expect(gesetzlicheFaelligkeit(DEZ)).toBe("2027-01-10");
    expect(dueDate(DEZ)).toBe("2027-01-11");
    expect(gesetzlicheFaelligkeit(DEZ, true)).toBe("2027-02-10");
    expect(gesetzlicheFaelligkeit({ year: 2026, month: 44 })).toBe("2027-01-10");
    expect(gesetzlicheFaelligkeit({ year: 2026, month: 11 }, true)).toBe("2027-01-10");
  });
});

describe("ustVorauszahlungImVorjahr (§ 11 Abs. 2 Satz 2 EStG)", () => {
  it("Dezember, fällig 10.01., gezahlt 01.01. bis 10.01.: Vorjahr", () => {
    expect(zahlung("2027-01-01")).toBe(true);
    expect(zahlung("2027-01-08")).toBe(true);
    expect(zahlung("2027-01-10")).toBe(true);
  });
  it("gezahlt am 11.01., auch wenn der 10.01. ein Sonntag ist: Zahlungsjahr", () => {
    expect(zahlung("2027-01-11")).toBe(false);
  });
  it("mit Dauerfristverlängerung fällig am 10.02.: Zahlungsjahr (BFH VIII R 25/20)", () => {
    expect(zahlung("2027-01-08", DEZ, true)).toBe(false);
  });
  it("viertes Quartal: wie Dezember; mit Dauerfristverlängerung Zahlungsjahr", () => {
    expect(zahlung("2027-01-08", { year: 2026, month: 44 })).toBe(true);
    expect(zahlung("2027-01-08", { year: 2026, month: 44 }, true)).toBe(false);
  });
  it("November ohne Dauerfristverlängerung fällig am 10.12., verspätet gezahlt: Zahlungsjahr (BFH X R 2/21)", () => {
    expect(zahlung("2027-01-05", { year: 2026, month: 11 })).toBe(false);
    expect(zahlung("2027-01-09", { year: 2026, month: 5 })).toBe(false);
  });
  it("November mit Dauerfristverlängerung fällig am 10.01.: Vorjahr", () => {
    expect(zahlung("2027-01-05", { year: 2026, month: 11 }, true)).toBe(true);
  });
  it("Erstattung: Jahr des Zuflusses", () => {
    expect(zahlung("2027-01-08", DEZ, false, false)).toBe(false);
  });
  it("gezahlt im Dezember oder für einen Zeitraum eines anderen Jahres: unverändert", () => {
    expect(zahlung("2026-12-28")).toBe(false);
    expect(zahlung("2027-01-08", { year: 2027, month: 1 })).toBe(false);
    expect(zahlung("2027-01-08", { year: 2025, month: 12 })).toBe(false);
  });
});
