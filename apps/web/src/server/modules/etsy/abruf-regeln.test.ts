import { describe, expect, it } from "vitest";
import { gebuehrenBisAm, laenderHinweis, naechsterAbrufStart } from "./abruf-regeln.ts";

describe("Regeln des Etsy-Abrufs", () => {
  it("bündelt einen Monat erst ab dem 5. des Folgemonats", () => {
    expect(gebuehrenBisAm("2026-11-04")).toBe("2026-09-30");
    expect(gebuehrenBisAm("2026-11-05")).toBe("2026-10-31");
    expect(gebuehrenBisAm("2026-11-30")).toBe("2026-10-31");
    expect(gebuehrenBisAm("2026-03-05")).toBe("2026-02-28");
  });

  it("rechnet über den Jahreswechsel", () => {
    expect(gebuehrenBisAm("2027-01-03")).toBe("2026-11-30");
    expect(gebuehrenBisAm("2027-01-05")).toBe("2026-12-31");
    expect(gebuehrenBisAm("2027-02-01")).toBe("2026-12-31");
  });

  it("holt den laufenden Monat bei jedem Abruf ab seinem 1., weil er noch nicht gebündelt ist", () => {
    // Oktober ist gebündelt (Abruf am 20.11.), die jüngste Zeile vom 19.11.: nicht ab dem 16.11., sonst fehlten am 5.12.
    // die November-Gebühren vom 1. bis 15.
    expect(naechsterAbrufStart(["2026-11-02", "2026-11-19"], "2026-11-01", "2026-10-31")).toBe("2026-11-01");
  });

  it("hält den Abruf am 1. des noch nicht gebündelten Monats fest, damit dessen Gebühren nicht verloren gehen", () => {
    // Am 2.11. ist der Oktober noch offen: Seine Gebühren vom 3.10. müssen beim Abruf am 5.11. noch dabei sein
    expect(naechsterAbrufStart(["2026-10-03", "2026-11-02"], "2026-10-01", "2026-09-30")).toBe("2026-10-01");
    // Am 20.11. ist der Oktober gebündelt, der November offen: ab dem 1.11.
    expect(naechsterAbrufStart(["2026-11-19"], "2026-10-01", "2026-10-31")).toBe("2026-11-01");
  });

  it("geht nie vor den bisherigen Start zurück, auch nicht vor einen frisch gewählten Monat", () => {
    // Am 3.11. „Abruf ab 2026-11“ gewählt: der Oktober ist noch offen, gehört aber nicht dazu
    expect(naechsterAbrufStart(["2026-11-02"], "2026-11-01", "2026-09-30")).toBe("2026-11-01");
  });

  it("lässt den Start ohne neue Zeilen stehen", () => {
    expect(naechsterAbrufStart([], "2026-11-01", "2026-10-31")).toBe("2026-11-01");
  });

  it("darf mit der Überlappung in einen gebündelten Monat reichen; der Import überspringt dessen Gebühren", () => {
    // Abruf am 6.11. bündelt den Oktober, die jüngste Zeile ist vom 2.11.
    expect(naechsterAbrufStart(["2026-11-02"], "2026-10-01", "2026-10-31")).toBe("2026-10-30");
  });

  it("zählt die Bestellungen nach Land", () => {
    const laender = new Map([
      ["1", "DE"],
      ["2", "US"],
      ["3", "US"],
      ["4", "FR"],
    ]);
    expect(laenderHinweis(["1", "2", "3", "4", "5"], laender)).toBe(
      "Bestellungen nach Land: 1 Deutschland (19 %), 2 USA (nicht steuerbar, Kz 45), 1 anderes Land (Steuer klären, keine Rechnung), 1 ohne Land.",
    );
    expect(laenderHinweis([], laender)).toBeNull();
  });
});
