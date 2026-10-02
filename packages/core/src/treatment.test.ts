import { describe, expect, it } from "vitest";
import { treatmentIssues, treatmentNote } from "./treatment.ts";

describe("treatmentIssues", () => {
  it("Reverse Charge braucht beide USt-IdNrn. und einen Kunden im Ausland", () => {
    expect(treatmentIssues("reverse_charge", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "ATU12345678", buyerCountry: "AT" })).toEqual([]);
    expect(treatmentIssues("reverse_charge", { rates: [1900], buyerCountry: "DE" })).toHaveLength(4);
  });

  it("steuerfrei braucht die Vorschrift", () => {
    expect(treatmentIssues("steuerfrei", { rates: [0] })).toHaveLength(1);
    expect(treatmentIssues("steuerfrei", { rates: [0], exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG" })).toEqual([]);
  });

  it("regulär prüft nichts", () => {
    expect(treatmentIssues("regulaer", { rates: [1900, 0] })).toEqual([]);
  });
});

describe("treatmentNote", () => {
  it("eigener Text vor Standardtext", () => {
    expect(treatmentNote("regulaer")).toBeNull();
    expect(treatmentNote("kleinunternehmer")).toContain("§ 19 UStG");
    expect(treatmentNote("steuerfrei", " Steuerfrei nach § 4 Nr. 21 UStG ")).toBe("Steuerfrei nach § 4 Nr. 21 UStG");
  });
});
