import { describe, expect, it } from "vitest";
import { outgoingTaxIssues } from "./outgoing-tax-policy.ts";
import type { OutgoingTaxDetails } from "./outgoing-tax.ts";

const details = (change: Partial<OutgoingTaxDetails> = {}): OutgoingTaxDetails => ({
  exemption: null,
  ancillary: null,
  foreignPlace: null,
  assetDisposal: false,
  ...change,
});

describe("Gemeinsame Regeln für Ausgangsbelege", () => {
  it.each([{ number: "14", letter: "a" }, { number: "21" }])("erlaubt die bestätigte eigene KU-Befreiung %j", (exemption) => {
    expect(outgoingTaxIssues("steuerfrei", details({ exemption }), true)).toEqual([]);
  });

  it("deutet den ungeklärten KU-Bestand nicht in eine eigene Befreiung um", () => {
    expect(outgoingTaxIssues("steuerfrei", null, true).join(" ")).toContain("Vorschrift");
    expect(outgoingTaxIssues("kleinunternehmer", null, true)).toEqual([]);
    expect(outgoingTaxIssues("steuerfrei", null, false)).toEqual([]);
  });

  it.each(["regulaer", "ig_lieferung", "ausfuhr"] as const)("gibt %s für KU nicht pauschal frei", (treatment) => {
    expect(outgoingTaxIssues(treatment, null, true).join(" ")).toContain("Als Kleinunternehmer");
  });

  it("lässt ohne KU-Einstellung weiterhin keine §-19-Rechnung zu", () => {
    expect(outgoingTaxIssues("kleinunternehmer", null, false)).not.toEqual([]);
  });

  it.each(["DE", "CH", "XX"])("ersetzt beim neuen EU-Fall den geklärten Leistungsort nicht durch %s", (country) => {
    expect(outgoingTaxIssues("eu_sonstige", details({ foreignPlace: { country, noForeignVat: true } }), true)).not.toEqual([]);
  });

  it("braucht für den neuen EU-Fall den Ort und die geklärte ausländische Behandlung", () => {
    expect(outgoingTaxIssues("eu_sonstige", null, false)).not.toEqual([]);
    expect(outgoingTaxIssues("eu_sonstige", details({ foreignPlace: { country: "AT", noForeignVat: false } }), false)).not.toEqual([]);
    expect(outgoingTaxIssues("eu_sonstige", details({ foreignPlace: { country: "AT", noForeignVat: true } }), true)).toEqual([]);
  });

  it.each(["reverse_charge", "drittland"] as const)("bestätigt den KU-Leistungsort bei %s nicht aus dem Kundensitz", (treatment) => {
    expect(outgoingTaxIssues(treatment, null, true)).not.toEqual([]);
    expect(outgoingTaxIssues(treatment, details({ foreignPlace: { country: treatment === "drittland" ? "CH" : "AT", noForeignVat: true } }), true)).toEqual([]);
    expect(outgoingTaxIssues(treatment, null, false)).toEqual([]);
  });

  it.each([
    ["reverse_charge", "CH"],
    ["drittland", "AT"],
    ["reverse_charge", "DE"],
  ] as const)("erkennt den Widerspruch zwischen %s und Leistungsort %s", (treatment, country) => {
    expect(outgoingTaxIssues(treatment, details({ foreignPlace: { country, noForeignVat: true } }), false).join(" ")).toContain("Leistungsort");
  });
});
