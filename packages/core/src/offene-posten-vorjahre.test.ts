import { describe, expect, it } from "vitest";
import { istVorjahr, jahrVonDatum, vorjahresStand, vorjahresVermerk } from "./offene-posten-vorjahre.ts";

/*
 * Was aus früheren Jahren noch offen ist (#1110): Die Tabellen der offenen Posten zeigen den Stand von heute,
 * unabhängig vom gewählten Jahr. Gezählt wird, was vor dem gewählten Jahr entstanden ist – mit den Pluralformen,
 * die in der Zeile über der Tabelle stehen.
 */

describe("Vorjahresposten über der Tabelle", () => {
  const posten = (date: string, open = 11900) => ({ date, open });

  it("nennt einen einzelnen Posten im Singular und mehrere im Plural", () => {
    expect(vorjahresStand([posten("2025-06-03")], 2026).text).toBe("1 offener Posten aus einem früheren Jahr");
    expect(vorjahresStand([posten("2025-06-03"), posten("2024-11-30")], 2026).text).toBe("2 offene Posten aus früheren Jahren");
    expect(vorjahresStand([posten("2025-06-03"), posten("2024-11-30"), posten("2023-01-10")], 2026).text).toBe("3 offene Posten aus früheren Jahren");
  });

  it("schweigt, wenn nichts aus früheren Jahren offen ist", () => {
    expect(vorjahresStand([], 2026)).toEqual({ anzahl: 0, betrag: 0, text: null });
    expect(vorjahresStand([posten("2026-01-01")], 2026).text).toBeNull();
  });

  it("zählt das gewählte Jahr nicht mit, auch nicht seinen letzten Tag", () => {
    const gemischt = [posten("2026-12-31"), posten("2025-12-31"), posten("2027-02-01")];
    const stand = vorjahresStand(gemischt, 2026);
    expect(stand.anzahl).toBe(1);
    expect(stand.text).toBe("1 offener Posten aus einem früheren Jahr");
  });

  it("summiert die offenen Beträge der Vorjahre, Vorzeichen wie in der Tabelle", () => {
    const stand = vorjahresStand([posten("2025-06-03", 11900), posten("2024-11-30", -1900), posten("2026-02-02", 5000)], 2026);
    expect(stand.betrag).toBe(10000);
  });

  it("kennzeichnet die Zeile mit ihrem Jahr", () => {
    expect(vorjahresVermerk("2025-06-03", 2026)).toBe("aus 2025");
    expect(vorjahresVermerk("2026-01-01", 2026)).toBeNull();
    expect(vorjahresVermerk("", 2026)).toBeNull();
  });

  it("liest das Jahr aus dem Datum und lässt fehlende Angaben aus", () => {
    expect(jahrVonDatum("2025-06-03")).toBe(2025);
    expect(jahrVonDatum("")).toBe(0);
    expect(jahrVonDatum("ohne Datum")).toBe(0);
    expect(istVorjahr("", 2026)).toBe(false);
  });
});
