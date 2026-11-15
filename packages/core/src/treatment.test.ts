import { describe, expect, it } from "vitest";
import { inEuVatArea, treatmentIssues, treatmentNote } from "./treatment.ts";

describe("treatmentIssues", () => {
  it("Reverse Charge braucht beide USt-IdNrn. und einen Kunden im Ausland", () => {
    expect(treatmentIssues("reverse_charge", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "ATU12345678", buyerCountry: "AT" })).toEqual([]);
    expect(treatmentIssues("reverse_charge", { rates: [1900], buyerCountry: "DE" })).toHaveLength(4);
  });

  // § 1 Abs. 2a UStG: Monaco gilt als Gebiet Frankreichs; Unternehmen dort haben eine französische USt-IdNr.
  it("innergemeinschaftliche Lieferung an einen Kunden in Monaco mit französischer USt-IdNr.", () => {
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "FR40303265045", buyerCountry: "MC" })).toEqual([]);
  });

  it("Ausfuhrlieferung nicht an einen Kunden in Monaco, das zum Gemeinschaftsgebiet gehört", () => {
    expect(treatmentIssues("ausfuhr", { rates: [0], sellerUstId: "DE123456789", buyerCountry: "MC" })).toEqual([
      expect.stringContaining("Ausfuhrlieferung nur an Kunden außerhalb der EU"),
    ]);
  });

  it("steuerfrei braucht die Vorschrift", () => {
    expect(treatmentIssues("steuerfrei", { rates: [0] })).toHaveLength(1);
    expect(treatmentIssues("steuerfrei", { rates: [0], exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG" })).toEqual([]);
  });

  it("regulär prüft nichts", () => {
    expect(treatmentIssues("regulaer", { rates: [1900, 0] })).toEqual([]);
  });
});

describe("inEuVatArea", () => {
  it("Mitgliedstaaten und Monaco, nicht die Schweiz, Liechtenstein oder Großbritannien", () => {
    expect(["DE", "FR", "ie", "MC"].map(inEuVatArea)).toEqual([true, true, true, true]);
    expect(["CH", "LI", "GB", "AD", ""].map(inEuVatArea)).toEqual([false, false, false, false, false]);
  });
});

describe("treatmentNote", () => {
  it("eigener Text vor Standardtext", () => {
    expect(treatmentNote("regulaer")).toBeNull();
    expect(treatmentNote("kleinunternehmer")).toContain("§ 19 UStG");
    expect(treatmentNote("steuerfrei", " Steuerfrei nach § 4 Nr. 21 UStG ")).toBe("Steuerfrei nach § 4 Nr. 21 UStG");
  });
});
