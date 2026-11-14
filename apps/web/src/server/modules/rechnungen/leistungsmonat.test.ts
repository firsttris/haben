import { describe, expect, it } from "vitest";
import { gemeldeterZeitraum, leistungsmonatHinweis, zeitraumLabel } from "./leistungsmonat.ts";

describe("Leistungsmonat gegen gemeldete Voranmeldungen", () => {
  const q2 = { year: 2026, month: 42 };
  const mai = { year: 2026, month: 5 };

  it("trifft den Monat in einem gemeldeten Quartal", () => {
    expect(gemeldeterZeitraum("2026-05-31", [q2])).toEqual(q2);
  });

  it("trifft den Monat in einer gemeldeten Monatsanmeldung", () => {
    expect(gemeldeterZeitraum("2026-05-31", [mai])).toEqual(mai);
  });

  it("trifft nicht, wenn der Zeitraum offen ist", () => {
    expect(gemeldeterZeitraum("2026-08-15", [q2])).toBeNull();
  });

  it("trifft nicht über die Jahresgrenze", () => {
    expect(gemeldeterZeitraum("2025-05-31", [q2])).toBeNull();
  });

  it("beschriftet Quartal und Monat", () => {
    expect(zeitraumLabel(q2)).toBe("Q2/2026");
    expect(zeitraumLabel(mai)).toBe("05/2026");
  });

  const betrag = { net: 100_000, tax: 19_000 };

  it("nennt Zeitraum, Abgabe und Betrag und führt zur berichtigten Anmeldung", () => {
    const hinweis = leistungsmonatHinweis("2026-05-31", [{ ...q2, sentAt: new Date("2026-07-10T08:00:00Z") }], betrag);
    expect(hinweis).toContain("31.05.2026");
    expect(hinweis).toContain("Q2/2026, übermittelt am 10.07.2026");
    expect(hinweis).toContain("190,00");
    expect(hinweis).toContain("berichtigte Anmeldung");
    expect(hinweis).not.toContain("nächste Voranmeldung");
  });

  it("schweigt, wenn der Zeitraum offen ist", () => {
    expect(leistungsmonatHinweis("2026-08-15", [q2], betrag)).toBeNull();
  });
});
