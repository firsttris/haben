import { describe, expect, it } from "vitest";
import { billableAmount, billableMinutes, formatDuration, parseDuration, serviceAmount } from "./leistung.ts";

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
