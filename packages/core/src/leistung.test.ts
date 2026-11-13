import { describe, expect, it } from "vitest";
import { billableAmount, billableMinutes, billingPreview, formatDuration, type OffeneLeistung, parseDuration, serviceAmount } from "./leistung.ts";

describe("Dauer von Leistungseinträgen (#417)", () => {
  it("liest Stunden und Minuten in den üblichen Schreibweisen", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration("12:05")).toBe(725);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("2")).toBe(120);
    expect(parseDuration("0,25")).toBe(15);
    expect(parseDuration(" 1h 30min ")).toBe(90);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("2 Std")).toBe(120);
  });

  it("lehnt Unsinn, null, Minuten über 59 und mehr als einen Tag ab", () => {
    for (const bad of ["", "abc", "0", "0:00", "1:60", "-1", "25", "24:01", "1:5", "1,5,5", "1h 90min"]) expect(parseDuration(bad), bad).toBeNull();
    expect(parseDuration("24")).toBe(1440);
  });

  it("zeigt die Dauer als Stunden:Minuten", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(725)).toBe("12:05");
    expect(formatDuration(1440)).toBe("24:00");
  });
});

describe("Betrag eines Leistungseintrags (#417)", () => {
  it("rechnet Minuten mal Stundensatz auf ganze Cent, halbe Cent weg von null", () => {
    expect(serviceAmount(60, 9500)).toBe(9500);
    expect(serviceAmount(90, 9500)).toBe(14250);
    expect(serviceAmount(1, 9500)).toBe(158); // 158,33
    expect(serviceAmount(10, 9500)).toBe(1583); // 1583,33
    expect(serviceAmount(1, 50)).toBe(1); // 0,83 → 1
    expect(serviceAmount(3, 50)).toBe(3); // 2,5 → 3
    expect(serviceAmount(30, 0)).toBe(0);
  });
});

describe("abrechenbarer Betrag eines Eintrags (#417)", () => {
  it("nimmt die abrechenbare Dauer, wenn es eine gibt, sonst die erfasste", () => {
    expect(billableMinutes({ minutes: 90, billableMinutes: null, nonBillable: false })).toBe(90);
    expect(billableMinutes({ minutes: 90, billableMinutes: 60, nonBillable: false })).toBe(60);
  });

  it("ein nicht abrechenbarer Eintrag hat keine abrechenbare Zeit und keinen Betrag", () => {
    expect(billableMinutes({ minutes: 90, billableMinutes: 60, nonBillable: true })).toBe(0);
    expect(billableAmount({ minutes: 90, billableMinutes: null, nonBillable: true, hourlyRateCents: 9500 })).toBe(0);
  });

  it("rechnet den Betrag aus der abrechenbaren Dauer, ohne Satz null", () => {
    expect(billableAmount({ minutes: 90, billableMinutes: 60, nonBillable: false, hourlyRateCents: 9500 })).toBe(9500);
    expect(billableAmount({ minutes: 90, billableMinutes: null, nonBillable: false, hourlyRateCents: 9500 })).toBe(14250);
    expect(billableAmount({ minutes: 90, billableMinutes: null, nonBillable: false, hourlyRateCents: null })).toBe(0);
  });
});

describe("Positionen beim Abrechnen (#417)", () => {
  const eintrag = (workedOn: string, minutes: number, hourlyRateCents: number | null, project = ""): OffeneLeistung => ({
    workedOn,
    minutes,
    billableMinutes: null,
    nonBillable: false,
    hourlyRateCents,
    project,
  });

  it("fasst Einträge eines Stundensatzes zu einer Position zusammen, Projekte ohne Doppel", () => {
    const preview = billingPreview([
      eintrag("2026-03-02", 90, 9500, "Relaunch Shop"),
      { ...eintrag("2026-03-03", 120, 9500, "Relaunch Shop"), billableMinutes: 60 },
      eintrag("2026-03-04", 30, 9500),
    ]);
    expect(preview).toEqual({
      entries: 3,
      minutes: 180,
      net: 28_500,
      withoutRate: 0,
      lines: [{ rateCents: 9500, minutes: 180, quantity: 3000, net: 28_500, projects: ["Relaunch Shop"] }],
      from: "2026-03-02",
      to: "2026-03-04",
    });
  });

  it("rundet die Menge einmal je Position auf Tausendstel und das Netto halb weg von null", () => {
    // 100 Minuten = 1,6667 Std. → 1667; 1667 × 95 € = 15.836,5 Cent → 15.837
    expect(billingPreview([eintrag("2026-03-02", 100, 9500)]).lines[0]).toMatchObject({ quantity: 1667, net: 15_837 });
    // dreimal 20 Minuten sind 1,000 Std., nicht dreimal 0,333
    expect(billingPreview([eintrag("2026-03-02", 20, 9500), eintrag("2026-03-03", 20, 9500), eintrag("2026-03-04", 20, 9500)]).lines[0]).toMatchObject({
      quantity: 1000,
      net: 9500,
    });
    // 1,5 Std. × 0,33 € = 49,5 Cent → 50
    expect(billingPreview([eintrag("2026-03-02", 90, 33)]).lines[0]).toMatchObject({ quantity: 1500, net: 50 });
  });

  it("eine Position je Stundensatz, aufsteigend; Einträge ohne Satz zählen nur für Zeitraum und Hinweis", () => {
    const preview = billingPreview([
      eintrag("2026-03-01", 45, null),
      eintrag("2026-03-02", 100, 12_000, "Support"),
      eintrag("2026-03-03", 100, 9500, "Relaunch Shop"),
      eintrag("2026-03-05", 60, 12_000, "Wartung"),
    ]);
    expect(preview.lines).toEqual([
      { rateCents: 9500, minutes: 100, quantity: 1667, net: 15_837, projects: ["Relaunch Shop"] },
      { rateCents: 12_000, minutes: 160, quantity: 2667, net: 32_004, projects: ["Support", "Wartung"] },
    ]);
    expect(preview).toMatchObject({ entries: 3, minutes: 260, net: 47_841, withoutRate: 1, from: "2026-03-01", to: "2026-03-05" });
  });

  it("ohne Einträge keine Position und kein Zeitraum", () => {
    expect(billingPreview([])).toEqual({ entries: 0, minutes: 0, net: 0, withoutRate: 0, lines: [], from: null, to: null });
  });
});
