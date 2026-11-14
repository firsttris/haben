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

  it("gibt ohne Leistungsdatum keinen Hinweis", () => {
    expect(leistungsmonatHinweis(null, [q2])).toBeNull();
  });

  it("nennt Zeitraum und Leistungsmonat im Hinweis", () => {
    const hinweis = leistungsmonatHinweis("2026-05-31", [q2]);
    expect(hinweis).toContain("05/2026");
    expect(hinweis).toContain("Q2/2026");
    expect(hinweis).toContain("nächste Voranmeldung");
  });

  it("schweigt, wenn der Zeitraum offen ist", () => {
    expect(leistungsmonatHinweis("2026-08-15", [q2])).toBeNull();
  });
});
