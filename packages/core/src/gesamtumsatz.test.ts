import { describe, expect, it } from "vitest";
import { classifyTurnover, turnoverForYear, type TurnoverClassification, type TurnoverItem } from "./gesamtumsatz.ts";

const section4 = (number: string, letter: string | null = null, ancillary: boolean | null = null): TurnoverClassification => ({
  kind: "section4",
  provision: { number, letter },
  ancillary,
});
const item = (sourceId: string, net: number | null, classification: TurnoverClassification | null, occurredOn: string | null = "2026-11-01"): TurnoverItem => ({
  source: "bank",
  sourceId,
  net,
  classification,
  occurredOn,
  basisSource: "stored",
});

describe("Gesamtumsatz nach § 19 Abs. 2: strukturierte Einordnung", () => {
  // Amtliche Fassung: https://www.gesetze-im-internet.de/ustg_1980/__19.html
  // Ein tatsächlich befreiter Umsatz ist Voraussetzung, nicht das Ergebnis dieser Zählregel.
  it.each([
    "11",
    "11a",
    "11b",
    "12",
    "13",
    "14",
    "15",
    "15a",
    "15b",
    "15c",
    "16",
    "17",
    "18",
    "18a",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "28",
    "29",
  ])("zieht tatsächlich nach § 4 Nr. %s befreite Umsätze ab", (number) => {
    expect(classifyTurnover(section4(number)).decision).toBe("excluded");
  });
  it.each([
    ["8", "i"],
    ["9", "b"],
  ])("zieht § 4 Nr. %s Buchst. %s ohne Hilfsumsatzprüfung ab", (number, letter) => {
    expect(classifyTurnover(section4(number, letter)).decision).toBe("excluded");
  });
  it.each(["a", "b", "c", "d", "e", "f", "g", "h"])("zählt § 4 Nr. 8 Buchst. %s nur außerhalb eines Hilfsumsatzes", (letter) => {
    expect(classifyTurnover(section4("8", letter, false)).decision).toBe("included");
    expect(classifyTurnover(section4("8", letter, true)).decision).toBe("excluded");
    expect(classifyTurnover(section4("8", letter)).decision).toBe("unknown");
  });
  it.each([
    ["9", "a"],
    ["10", null],
    ["10", "a"],
    ["10", "b"],
  ])("prüft bei § 4 Nr. %s/%s die Hilfsumsatzeinordnung", (number, letter) => {
    expect(classifyTurnover(section4(number!, letter, false)).decision).toBe("included");
    expect(classifyTurnover(section4(number!, letter, true)).decision).toBe("excluded");
    expect(classifyTurnover(section4(number!, letter)).decision).toBe("unknown");
  });
  it.each(["1", "2", "3", "4", "4b", "4c", "5", "6", "7"])("zieht § 4 Nr. %s nicht pauschal ab", (number) => {
    expect(classifyTurnover(section4(number)).decision).toBe("included");
  });
  it.each([section4("8"), section4("9"), section4("8", "j"), section4("30"), section4("14z"), null])(
    "lässt unzureichende oder nicht unterstützte Vorschriften ungeklärt",
    (classification) => {
      expect(classifyTurnover(classification).decision).toBe("unknown");
    },
  );
  it("braucht einen bestätigten ausländischen Leistungsort und errät ihn nicht aus einer Anschrift", () => {
    expect(classifyTurnover({ kind: "foreign", confirmed: false }).decision).toBe("unknown");
    expect(classifyTurnover({ kind: "foreign", confirmed: true }).decision).toBe("excluded");
  });
  it.each(["asset_disposal", "not_turnover"] as const)("zieht %s ohne Erlöskontoheuristik ab", (kind) => {
    expect(classifyTurnover({ kind }).decision).toBe("excluded");
  });
});

describe("Gesamtumsatz nach tatsächlichen Entgelten", () => {
  it("trennt 60.000 Euro Heilbehandlung von 5.000 Euro gewöhnlichen KU-Einnahmen", () => {
    const result = turnoverForYear(2026, [item("heilbehandlung", 6_000_000, section4("14", "a")), item("ku", 500_000, { kind: "domestic" })]);
    expect(result.included).toBe(500_000);
    expect(result.complete).toBe(true);
    expect(result.items.map((entry) => entry.decision)).toEqual(["excluded", "included"]);
  });
  it("verwendet das Nettoentgelt, weder Brutto noch EÜR-Gewinn", () => {
    expect(turnoverForYear(2026, [item("119-euro-zahlung", 10_000, { kind: "domestic" })]).included).toBe(10_000);
  });
  it("zählt Teilzahlungen und tatsächliche Rückzahlungen genau am Zahlungstag", () => {
    const result = turnoverForYear(2026, [
      item("teil1", 11_111, { kind: "domestic" }),
      item("teil2", 22_222, { kind: "domestic" }),
      item("rueckzahlung", -3_333, { kind: "domestic" }),
    ]);
    expect(result.included).toBe(30_000);
    expect(result.complete).toBe(true);
  });
  it("trennt Anzahlung und spätere Restzahlung über den Jahreswechsel", () => {
    const entries = [item("anzahlung", 30_000, { kind: "domestic" }, "2026-12-15"), item("rest", 70_000, { kind: "domestic" }, "2027-01-15")];
    expect(turnoverForYear(2026, entries).included).toBe(30_000);
    expect(turnoverForYear(2027, entries).included).toBe(70_000);
  });
  it("behält bei späterer Zuordnung das ursprüngliche Zahlungsdatum", () => {
    const original = item("zahlung-vor-rechnung", 12_345, null, "2026-11-05");
    expect(turnoverForYear(2026, [original])).toMatchObject({ included: 0, complete: false });
    const classified = { ...original, classification: { kind: "domestic" } as const };
    expect(turnoverForYear(2026, [classified])).toMatchObject({ included: 12_345, complete: true });
    expect(turnoverForYear(2026, [classified]).items[0]?.occurredOn).toBe("2026-11-05");
  });
  it("neutralisiert Aufhebung und Neuzuordnung am selben Banktag, ohne eine weitere Zahlung zu erfinden", () => {
    const entries = [
      item("zuordnung", 10_000, { kind: "domestic" }),
      item("gegenzeile", -10_000, { kind: "domestic" }),
      item("neu", 10_000, { kind: "domestic" }),
    ];
    expect(turnoverForYear(2026, entries).included).toBe(10_000);
  });
  it("erhält ungeklärte alte §-4-Freitexte ohne Umdeutung als sichtbare Beiträge", () => {
    const unknown = item("alter-freitext", 12_345, { kind: "section4", provision: null, ancillary: null });
    const result = turnoverForYear(2026, [unknown, item("geklaert", 10_000, { kind: "domestic" })]);
    expect(result).toMatchObject({ included: 10_000, complete: false });
    expect(result.items[0]).toMatchObject({ sourceId: "alter-freitext", net: 12_345, decision: "unknown" });
  });
  it.each([null, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rechnet ungeklärtes oder ungültiges Netto %s nicht als null-Euro-Zahlung grün", (net) => {
    const result = turnoverForYear(2026, [item("betrag", net, { kind: "domestic" })]);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items[0]?.decision).toBe("unknown");
  });
  it.each([null, "", "2026-02-30", "2026-02-29", "2026-13-01", "2026-1-01"])("lässt ein nicht belastbares Zahlungsdatum %s ungeklärt", (date) => {
    expect(turnoverForYear(2026, [item("datum", 100, { kind: "domestic" }, date)])).toMatchObject({ included: 0, complete: false });
  });
  it("berücksichtigt einen gültigen Schalttag und grenzt beide Jahresränder korrekt ab", () => {
    const entries = [
      item("vorjahr", 1_000, null, "2027-12-31"),
      item("erster", 100, { kind: "domestic" }, "2028-01-01"),
      item("schalt", 200, { kind: "domestic" }, "2028-02-29"),
      item("letzter", 300, { kind: "domestic" }, "2028-12-31"),
      item("folgejahr", 1_000, null, "2029-01-01"),
    ];
    expect(turnoverForYear(2028, entries)).toMatchObject({ included: 600, complete: true });
  });
  it("braucht für sicher ausgeschlossene Umsätze keinen erfundenen Betrag oder Zahlungstag", () => {
    expect(turnoverForYear(2026, [item("anlage", null, { kind: "asset_disposal" }, null)])).toMatchObject({ included: 0, complete: true });
  });
  it("kennzeichnet unbekannte Betragsherkunft auch bei einem vorhandenen Zahlenwert", () => {
    expect(turnoverForYear(2026, [{ ...item("herkunft", 100, { kind: "domestic" }), basisSource: "unknown" }])).toMatchObject({ included: 0, complete: false });
    expect(turnoverForYear(2026, [{ ...item("altbeleg", 100, { kind: "domestic" }), basisSource: "derived" }])).toMatchObject({
      included: 100,
      complete: true,
    });
  });
  it("weist dieselbe Quellenidentität doppelt zurück, nicht zwei echte Zahlungen mit gleichem Datum/Betrag", () => {
    const payment = item("identisch", 100, { kind: "domestic" });
    expect(() => turnoverForYear(2026, [payment, payment])).toThrow(/doppelt/i);
    expect(turnoverForYear(2026, [payment, { ...payment, sourceId: "anderer-umsatz" }]).included).toBe(200);
    expect(turnoverForYear(2026, [payment, { ...payment, source: "cash" }]).included).toBe(200);
  });
  it("liefert keine ungenaue Summe oberhalb sicherer ganzzahliger Centbeträge", () => {
    expect(() => turnoverForYear(2026, [item("a", Number.MAX_SAFE_INTEGER, { kind: "domestic" }), item("b", 1, { kind: "domestic" })])).toThrow(RangeError);
  });
  it.each([2024, 2026.5, Number.NaN, 2101])("wendet die Fassung ab 2025 nicht auf ein unqualifiziertes Jahr %s an", (year) => {
    expect(() => turnoverForYear(year, [])).toThrow(RangeError);
  });
});
