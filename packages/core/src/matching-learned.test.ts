import { describe, expect, it } from "vitest";
import { learnedDirectBooking, mostFrequent } from "./matching.ts";

describe("mostFrequent", () => {
  it("nimmt den häufigsten Wert, bei Gleichstand den zuletzt verwendeten", () => {
    expect(
      mostFrequent([
        { value: "a", count: 2, last: "2026-05-01" },
        { value: "b", count: 3, last: "2026-01-01" },
      ]),
    ).toEqual({ value: "b", count: 3, total: 5 });
    expect(
      mostFrequent([
        { value: "a", count: 2, last: "2026-05-01" },
        { value: "b", count: 2, last: "2026-06-01" },
      ]),
    ).toEqual({ value: "b", count: 2, total: 4 });
    expect(mostFrequent([])).toBeNull();
  });
});

describe("learnedDirectBooking", () => {
  const tx = { counterpartyName: "DKB AG" };
  const h = (value: string, count: number) => ({ value, count, last: "2026-09-01" });

  it("schlägt die häufigste Buchungsart vor, ab zwei Umsätzen und mit Mehrheit", () => {
    expect(learnedDirectBooking(tx, [h("gebuehren", 3), h("privat", 1)], 4, "iban")).toEqual({
      kind: "gebuehren",
      reasons: ["3 von 4 Umsätzen mit dieser Gegen-IBAN so gebucht"],
    });
    expect(learnedDirectBooking(tx, [h("privat", 2)], 2, "name")?.reasons).toEqual(["2 von 2 Umsätzen von dieser Gegenpartei so gebucht"]);
    expect(learnedDirectBooking(tx, [h("gebuehren", 1)], 1, "iban")).toBeNull();
    // Ein aufgeteilter Umsatz zählt bei jeder Art, insgesamt aber einmal: 2 von 3 Umsätzen sind eine Mehrheit
    expect(learnedDirectBooking(tx, [h("privat", 2), h("invoice", 1), h("gebuehren", 1)], 3, "iban")?.reasons).toEqual([
      "2 von 3 Umsätzen mit dieser Gegen-IBAN so gebucht",
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
});
