import { describe, expect, it } from "vitest";
import type { TurnoverClassification } from "./gesamtumsatz.ts";
import { type OutgoingTaxDetails, outgoingTaxClassification, outgoingTaxDetailConflict, section4Note } from "./outgoing-tax.ts";

const details = (changes: Partial<OutgoingTaxDetails> = {}): OutgoingTaxDetails => ({
  exemption: null,
  ancillary: null,
  foreignPlace: null,
  assetDisposal: false,
  ...changes,
});

describe("outgoingTaxDetailConflict", () => {
  it("unterscheidet bekannte Nummern und Buchstaben derselben Befreiungsart", () => {
    const first = details({ exemption: { number: "14", letter: "a" } });
    expect(outgoingTaxDetailConflict("steuerfrei", first, details({ exemption: { number: "21" } }))).toBe("exemption");
    expect(outgoingTaxDetailConflict("steuerfrei", first, details({ exemption: { number: "14", letter: "b" } }))).toBe("exemption");
    expect(outgoingTaxDetailConflict("steuerfrei", first, structuredClone(first))).toBeNull();
    expect(
      outgoingTaxDetailConflict("steuerfrei", details({ exemption: { number: "21" } }), details({ exemption: { number: "21", letter: null } })),
    ).toBeNull();
  });

  it.each(["reverse_charge", "drittland", "eu_sonstige"] as const)("vergleicht bei %s den tatsächlichen Ort, nicht die Steuerbestätigung", (treatment) => {
    const first = details({ foreignPlace: { country: "AT", noForeignVat: true } });
    expect(outgoingTaxDetailConflict(treatment, first, details({ foreignPlace: { country: "FR", noForeignVat: true } }))).toBe("foreignPlace");
    expect(outgoingTaxDetailConflict(treatment, first, details({ foreignPlace: { country: "AT", noForeignVat: false } }))).toBeNull();
  });

  it("erfindet bei ungeklärten Altangaben weder einen Konflikt noch eine Zuordnung", () => {
    const known = details({ exemption: { number: "14", letter: "a" }, foreignPlace: { country: "AT", noForeignVat: true } });
    const before = structuredClone(known);
    for (const missing of [null, undefined, details()]) {
      expect(outgoingTaxDetailConflict("steuerfrei", missing, known)).toBeNull();
      expect(outgoingTaxDetailConflict("eu_sonstige", known, missing)).toBeNull();
    }
    expect(known).toEqual(before);
  });

  it("macht aus Angaben anderer Steuerarten, Hilfsumsatz und Anlagenveräußerung keine neue Abzugssperre", () => {
    const first = details({ exemption: { number: "14", letter: "a" }, foreignPlace: { country: "AT", noForeignVat: true } });
    const second = details({ exemption: { number: "21" }, foreignPlace: { country: "FR", noForeignVat: true }, ancillary: true, assetDisposal: true });
    expect(outgoingTaxDetailConflict("kleinunternehmer", first, second)).toBeNull();
    expect(outgoingTaxDetailConflict("regulaer", first, second)).toBeNull();
    expect(outgoingTaxDetailConflict("steuerfrei", first, { ...second, exemption: first.exemption })).toBeNull();
  });
});

describe("section4Note", () => {
  it.each([null, undefined])("erfindet bei fehlender Vorschrift keinen Befreiungshinweis (%s)", (provision) => {
    expect(section4Note(provision)).toBeNull();
  });

  it("nennt die strukturierte Vorschrift mit Buchstaben", () => {
    expect(section4Note({ number: "14", letter: "a" })).toBe("Steuerfreie Leistung nach § 4 Nr. 14 Buchst. a UStG.");
  });

  it.each([undefined, null, ""])("lässt einen nicht angegebenen Buchstaben weg (%s)", (letter) => {
    expect(section4Note({ number: "21", letter })).toBe("Steuerfreie Leistung nach § 4 Nr. 21 UStG.");
  });

  it("erhält einen Zusatz der Nummer als Teil der strukturierten Vorschrift", () => {
    expect(section4Note({ number: "4b" })).toBe("Steuerfreie Leistung nach § 4 Nr. 4b UStG.");
  });
});

describe("outgoingTaxClassification", () => {
  it.each(["regulaer", "kleinunternehmer"] as const)("zählt %s ohne weitere Zuordnung als inländischen Umsatz", (treatment) => {
    expect(outgoingTaxClassification(treatment, undefined)).toEqual({ kind: "domestic" });
    expect(outgoingTaxClassification(treatment, null)).toEqual({ kind: "domestic" });
  });

  it.each(["regulaer", "kleinunternehmer", "steuerfrei", "reverse_charge", "drittland", "eu_sonstige", "ausfuhr", "ig_lieferung"] as const)(
    "stellt bei %s die ausdrücklich erfasste Anlagenveräußerung voran",
    (treatment) => {
      const input = details({ exemption: { number: "14", letter: "a" }, foreignPlace: { country: "AT", noForeignVat: true }, assetDisposal: true });
      expect(outgoingTaxClassification(treatment, input)).toEqual({ kind: "asset_disposal" });
    },
  );

  it.each([undefined, null, details()])("deutet fehlende strukturierte §-4-Zuordnung nicht um (%s)", (input) => {
    expect(outgoingTaxClassification("steuerfrei", input)).toEqual({ kind: "section4", provision: null, ancillary: null });
  });

  it.each([{ number: "14", letter: "a" }, { number: "21" }, { number: "8", letter: "i" }])(
    "übernimmt die ausdrücklich zugeordnete §-4-Vorschrift %j",
    (exemption) => {
      expect(outgoingTaxClassification("steuerfrei", details({ exemption }))).toEqual({ kind: "section4", provision: exemption, ancillary: null });
    },
  );

  it.each([true, false, null])("erhält die Entscheidung zum Hilfsumsatz als %s", (ancillary) => {
    const exemption = { number: "8", letter: "a" };
    expect(outgoingTaxClassification("steuerfrei", details({ exemption, ancillary }))).toEqual({ kind: "section4", provision: exemption, ancillary });
  });

  it.each(["reverse_charge", "drittland", "eu_sonstige"] as const)("lässt bei %s den Auslandsort ohne eigene Angabe ungeklärt", (treatment) => {
    expect(outgoingTaxClassification(treatment, undefined)).toEqual({ kind: "foreign", confirmed: false });
    expect(outgoingTaxClassification(treatment, null)).toEqual({ kind: "foreign", confirmed: false });
    expect(outgoingTaxClassification(treatment, details())).toEqual({ kind: "foreign", confirmed: false });
  });

  it.each(["reverse_charge", "drittland", "eu_sonstige"] as const)("übernimmt den ausdrücklich zugeordneten Auslandsort bei %s", (treatment) => {
    for (const country of ["AT", "FR", "US", "CH"]) {
      expect(outgoingTaxClassification(treatment, details({ foreignPlace: { country, noForeignVat: true } }))).toEqual({ kind: "foreign", confirmed: true });
    }
  });

  it.each(["", "DE", "de", "at", " AT", "AT ", "A", "AUT", "A1", "ÄT", "AT\n"])("bestätigt den Auslandsort nicht mit der Angabe %j", (country) => {
    for (const treatment of ["reverse_charge", "drittland", "eu_sonstige"] as const) {
      expect(outgoingTaxClassification(treatment, details({ foreignPlace: { country, noForeignVat: true } }))).toEqual({ kind: "foreign", confirmed: false });
    }
  });

  it.each([true, false])("trennt den Auslandsort vom fehlenden ausländischen Steuerausweis (%s)", (noForeignVat) => {
    expect(outgoingTaxClassification("eu_sonstige", details({ foreignPlace: { country: "AT", noForeignVat } }))).toEqual({ kind: "foreign", confirmed: true });
  });

  it.each([
    ["ausfuhr", "a"],
    ["ig_lieferung", "b"],
  ] as const)("ordnet %s der bereits feststehenden Vorschrift § 4 Nr. 1 %s zu", (treatment, letter) => {
    const expected: TurnoverClassification = { kind: "section4", provision: { number: "1", letter }, ancillary: null };
    expect(outgoingTaxClassification(treatment, null)).toEqual(expected);
    expect(outgoingTaxClassification(treatment, details({ exemption: { number: "21" }, ancillary: true }))).toEqual(expected);
  });

  it("verwendet Angaben zu anderen Behandlungen nicht als abweichende Umsatzart und verändert sie nicht", () => {
    const input = details({ exemption: { number: "14", letter: "a" }, ancillary: true, foreignPlace: { country: "AT", noForeignVat: true } });
    const original = structuredClone(input);
    expect(outgoingTaxClassification("regulaer", input)).toEqual({ kind: "domestic" });
    expect(outgoingTaxClassification("kleinunternehmer", input)).toEqual({ kind: "domestic" });
    expect(outgoingTaxClassification("drittland", input)).toEqual({ kind: "foreign", confirmed: true });
    expect(input).toEqual(original);
  });
});
