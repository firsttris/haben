import { describe, expect, it } from "vitest";
import { legacyNeutralKind, legacyNeutralSums } from "./legacy-einordnung.ts";

const kind = (categories: string[], rechtsform: "einzelunternehmen" | "gmbh" | "ug", privat = false) =>
  legacyNeutralKind({ privat, categories, tax: 0 }, rechtsform);

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
  it("Summen je Art, Zufluss und Abfluss brutto; eine Gutschrift mindert", () => {
    expect(
      legacyNeutralSums([
        { kind: "ertragsteuern", direction: "ausgabe", gross: 120_000 },
        { kind: "kapital", direction: "einnahme", gross: 2_500_000 },
        { kind: "ertragsteuern", direction: "einnahme", gross: -5_000 },
      ]),
    ).toEqual([
      { kind: "kapital", label: "Stammkapital und Darlehen", count: 1, zufluss: 2_500_000, abfluss: 0 },
      { kind: "ertragsteuern", label: "Körperschaft- und Gewerbesteuer", count: 2, zufluss: -5_000, abfluss: 120_000 },
    ]);
  });
});

describe("Review: Einordnung bei GmbH und UG", () => {
  it("ein Beleg mit Umsatzsteuer ist Leistungsaustausch und bleibt Einnahme bzw. Ausgabe (Private Kfz-Nutzung, § 3 Abs. 9a UStG)", () => {
    expect(legacyNeutralKind({ privat: false, categories: ["Private Kfz-Nutzung"], tax: 1_900 }, "gmbh")).toBeNull();
    expect(legacyNeutralKind({ privat: false, categories: ["Gesellschafter"], tax: -1_900 }, "ug")).toBeNull();
    expect(legacyNeutralKind({ privat: false, categories: ["Gesellschafter"], tax: 0 }, "gmbh")).toBe("gesellschafter");
  });

  it("Solidaritätszuschlag zur Lohnsteuer ist Lohnaufwand, keine Steuer vom Einkommen der GmbH", () => {
    expect(kind(["Lohnsteuer und Solidaritätszuschlag"], "gmbh")).toBeNull();
    expect(kind(["Solidaritätszuschlag"], "gmbh")).toBe("ertragsteuern");
  });

  it("Gutschriften mindern Zufluss bzw. Abfluss statt sie zu erhöhen", () => {
    expect(
      legacyNeutralSums([
        { kind: "gesellschafter", direction: "einnahme", gross: 100_000 },
        { kind: "gesellschafter", direction: "einnahme", gross: -100_000 },
        { kind: "gesellschafter", direction: "ausgabe", gross: 50_000 },
      ]),
    ).toEqual([{ kind: "gesellschafter", label: expect.any(String), count: 3, zufluss: 0, abfluss: 50_000 }]);
  });
});
