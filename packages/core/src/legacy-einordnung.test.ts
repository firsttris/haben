import { describe, expect, it } from "vitest";
import { legacyNeutralKind, legacyNeutralSums } from "./legacy-einordnung.ts";

const kind = (categories: string[], rechtsform: "einzelunternehmen" | "gmbh" | "ug", privat = false) => legacyNeutralKind({ privat, categories }, rechtsform);

describe("legacyNeutralKind", () => {
  it("Einzelunternehmen: unverändert das Kennzeichen aus dem Abruf", () => {
    expect(kind(["Privatentnahme"], "einzelunternehmen", true)).toBe("privat");
    expect(kind(["Gewerbesteuer"], "einzelunternehmen")).toBeNull();
    expect(kind(["Darlehen"], "einzelunternehmen")).toBeNull();
    expect(kind(["Privatentnahme"], "einzelunternehmen")).toBeNull();
  });

  it.each([
    ["Verrechnungskonto Gesellschafter", "gesellschafter"],
    ["Privatentnahme", "gesellschafter"],
    ["Privateinlage", "gesellschafter"],
    ["Einkommensteuer", "gesellschafter"],
    ["Gewinnausschüttung", "gesellschafter"],
    ["Kapitalertragsteuer", "gesellschafter"],
    ["Stammkapital", "kapital"],
    ["Kapitaleinlage", "kapital"],
    ["Gesellschafterdarlehen", "kapital"],
    ["Tilgung Darlehen", "kapital"],
    ["Körperschaftsteuer", "ertragsteuern"],
    ["Gewerbesteuer", "ertragsteuern"],
    ["Solidaritätszuschlag", "ertragsteuern"],
    ["Zinsen zur Gewerbesteuer", "ertragsteuern"],
    ["Geldtransit", "geldtransit"],
  ] as const)("GmbH: „%s“ ist %s", (category, expected) => {
    expect(kind([category], "gmbh")).toBe(expected);
    expect(kind([category], "ug")).toBe(expected);
  });

  it.each(["Zinsen für Darlehen", "Gehalt Gesellschafter-Geschäftsführer", "Miete an Gesellschafter", "Bürobedarf", "Erlöse 19 %", "Lohnsteuer"])(
    "GmbH: „%s“ bleibt Einnahme bzw. Ausgabe",
    (category) => {
      expect(kind([category], "gmbh")).toBeNull();
    },
  );

  it("GmbH: nur neutral, wenn jede Kategorie es ist; ohne Kategorie nie", () => {
    expect(kind(["Körperschaftsteuer", "Bürobedarf"], "gmbh")).toBeNull();
    expect(kind(["Körperschaftsteuer", "Gewerbesteuer"], "gmbh")).toBe("ertragsteuern");
    expect(kind([], "gmbh", true)).toBeNull();
  });
});

describe("legacyNeutralSums", () => {
  it("Summen je Art, Zufluss und Abfluss brutto ohne Vorzeichen", () => {
    expect(
      legacyNeutralSums([
        { kind: "ertragsteuern", direction: "ausgabe", gross: 120_000 },
        { kind: "kapital", direction: "einnahme", gross: 2_500_000 },
        { kind: "ertragsteuern", direction: "einnahme", gross: -5_000 },
      ]),
    ).toEqual([
      { kind: "kapital", label: "Stammkapital und Darlehen", count: 1, zufluss: 2_500_000, abfluss: 0 },
      { kind: "ertragsteuern", label: "Körperschaft- und Gewerbesteuer", count: 2, zufluss: 5_000, abfluss: 120_000 },
    ]);
  });
});
