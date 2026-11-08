import { describe, expect, it } from "vitest";
import { learnedDirectBooking, mostFrequent, type LearnedBooking } from "./matching.ts";

describe("mostFrequent", () => {
  it("nimmt den häufigsten Wert, bei Gleichstand den zuletzt verwendeten", () => {
    expect(
      mostFrequent([
        { value: "a", count: 2, last: "2026-05-01" },
        { value: "b", count: 3, last: "2026-01-01" },
      ]),
    ).toEqual({ value: "b", count: 3, total: 5, last: "2026-01-01" });
    expect(
      mostFrequent([
        { value: "a", count: 2, last: "2026-05-01" },
        { value: "b", count: 2, last: "2026-06-01" },
      ]),
    ).toEqual({ value: "b", count: 2, total: 4, last: "2026-06-01" });
    expect(mostFrequent([])).toBeNull();
  });
});

describe("learnedDirectBooking", () => {
  const tx = { counterpartyName: "DKB AG" };
  const h = (kind: string, count: number, last = "2026-09-01") => ({ value: { kind } as LearnedBooking, count, last });
  const k = (kategorie: string, steuersatz: number, count: number, last = "2026-09-01") => ({
    value: { kind: "kategorie", kategorie: { kategorie, steuersatz } } as LearnedBooking,
    count,
    last,
  });

  it("schlägt die häufigste Buchungsart vor, ab zwei Umsätzen und mit Mehrheit, mit dem Tag der letzten", () => {
    expect(learnedDirectBooking(tx, [h("gebuehren", 3, "2026-09-30"), h("privat", 1)], 4, "iban")).toEqual({
      kind: "gebuehren",
      reasons: ["3 von 4 Umsätzen mit dieser Gegen-IBAN so gebucht, zuletzt am 30.09.2026"],
    });
    expect(learnedDirectBooking(tx, [h("privat", 2)], 2, "name")?.reasons).toEqual([
      "2 von 2 Umsätzen von dieser Gegenpartei so gebucht, zuletzt am 01.09.2026",
    ]);
    expect(learnedDirectBooking(tx, [h("gebuehren", 1)], 1, "iban")).toBeNull();
    // Ein aufgeteilter Umsatz zählt bei jeder Art, insgesamt aber einmal: 2 von 3 Umsätzen sind eine Mehrheit
    expect(learnedDirectBooking(tx, [h("privat", 2), h("invoice", 1), h("gebuehren", 1)], 3, "iban")?.reasons).toEqual([
      "2 von 3 Umsätzen mit dieser Gegen-IBAN so gebucht, zuletzt am 01.09.2026",
    ]);
    // 2 von 4 ist keine Mehrheit
    expect(learnedDirectBooking(tx, [h("gebuehren", 2), h("privat", 2)], 4, "iban")).toBeNull();
  });

  it("nicht, wenn meist Rechnungen oder Belege zugeordnet wurden, nicht für Geldtransit, Umsatzsteuer oder das Finanzamt", () => {
    expect(learnedDirectBooking(tx, [h("invoice", 5), h("gebuehren", 2)], 7, "iban")).toBeNull();
    expect(learnedDirectBooking(tx, [h("geldtransit", 4)], 4, "iban")).toBeNull();
    expect(learnedDirectBooking(tx, [h("ustVorauszahlung", 4)], 4, "iban")).toBeNull();
    expect(learnedDirectBooking({ counterpartyName: "Finanzamt Regensburg" }, [h("privat", 4)], 4, "iban")).toBeNull();
  });

  it("nicht für Lohn, Sozialversicherung, Steuerzahlungen, Kapitalertragsteuer und Darlehen: dort gehen die Regeln vor", () => {
    for (const kind of ["lohn", "lohnsteuer", "sozialversicherung", "steuer", "kapest", "darlehen", "sondervorauszahlung", "kursdifferenz"]) {
      expect(learnedDirectBooking(tx, [h(kind, 4)], 4, "iban"), kind).toBeNull();
    }
  });

  it("lernt Zinserträge", () => {
    expect(learnedDirectBooking(tx, [h("zinsertrag", 3)], 3, "iban")?.kind).toBe("zinsertrag");
  });

  it("lernt die Kategorie mit Steuersatz aus „Direkt buchen“ (#324), jede Kategorie und jeder Satz für sich", () => {
    expect(learnedDirectBooking({ counterpartyName: "Kiosk am Markt" }, [k("telefon", 0, 12, "2026-10-02")], 12, "name")).toEqual({
      kind: "kategorie",
      kategorie: { kategorie: "telefon", steuersatz: 0 },
      reasons: ["12 von 12 Umsätzen von dieser Gegenpartei so gebucht, zuletzt am 02.10.2026"],
    });
    expect(learnedDirectBooking(tx, [k("erloese", 700, 3), k("erloese", 1900, 1)], 4, "iban")?.kategorie).toEqual({ kategorie: "erloese", steuersatz: 700 });
    // Zwei Kategorien je zur Hälfte: keine Mehrheit, kein Vorschlag
    expect(learnedDirectBooking(tx, [k("telefon", 0, 2), k("buero", 0, 2)], 4, "iban")).toBeNull();
    expect(learnedDirectBooking(tx, [k("erloese", 1900, 2), k("erloese", 700, 2)], 4, "iban")).toBeNull();
  });

  it("keine Kategorie, die heute nicht mehr direkt buchbar wäre, etwa Erlöse mit Steuer nach dem Wechsel zum Kleinunternehmer", () => {
    expect(learnedDirectBooking(tx, [k("erloese", 1900, 3)], 3, "iban", true)).toBeNull();
    expect(learnedDirectBooking(tx, [k("erloese", 0, 3)], 3, "iban", true)?.kategorie).toEqual({ kategorie: "erloese", steuersatz: 0 });
    // Umgekehrt: Kleinunternehmer-Erlöse sind nach dem Wechsel zur Regelbesteuerung kein Vorschlag mehr
    expect(learnedDirectBooking(tx, [k("erloese", 0, 3)], 3, "iban", false)).toBeNull();
    // Eine Kategorie, die es nicht mehr gibt oder die nur mit Beleg geht
    expect(learnedDirectBooking(tx, [k("gibtsnicht", 0, 3)], 3, "iban")).toBeNull();
    expect(learnedDirectBooking(tx, [k("bewirtung", 0, 3)], 3, "iban")).toBeNull();
  });
});
