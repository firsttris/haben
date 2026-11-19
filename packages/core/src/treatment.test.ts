import { describe, expect, it } from "vitest";
import { inEuVatArea, TAX_TREATMENTS, treatmentIssues, treatmentNote } from "./treatment.ts";

describe("treatmentIssues", () => {
  it("Reverse Charge braucht beide USt-IdNrn. und einen Kunden im Ausland", () => {
    expect(treatmentIssues("reverse_charge", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "ATU12345678", buyerCountry: "AT" })).toEqual([]);
    expect(treatmentIssues("reverse_charge", { rates: [1900], buyerCountry: "DE" })).toHaveLength(4);
  });

  // § 1 Abs. 2a UStG: Monaco gilt als Gebiet Frankreichs; Unternehmen dort haben eine französische USt-IdNr.
  it("innergemeinschaftliche Lieferung an einen Kunden in Monaco mit französischer USt-IdNr.", () => {
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "FR40303265045", buyerCountry: "MC" })).toEqual([]);
  });

  it("innergemeinschaftliche Lieferung nur mit einer USt-IdNr. im Aufbau des Landes (#1413)", () => {
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "ATU1234", buyerCountry: "AT" })).toEqual([
      "ATU1234: eine USt-IdNr. aus Österreich hat nach AT ein U und acht Ziffern",
    ]);
  });

  it("Storno und Korrektur einer innergemeinschaftlichen Lieferung ohne den Aufbau, aber mit den Regeln von ERiC (#1413)", () => {
    const gutschrift = { rates: [0], sellerUstId: "DE123456789", buyerCountry: "AT", correctsInvoice: true };
    expect(treatmentIssues("ig_lieferung", { ...gutschrift, buyerUstId: "ATU1234" })).toEqual([]);
    expect(treatmentIssues("ig_lieferung", { ...gutschrift, buyerUstId: "AT1234" })).toEqual([
      "AT1234: nach dem Länderkennzeichen 5 bis 12 Buchstaben, Ziffern, + oder *",
    ]);
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

  it("ohne 0 % in allen Positionen sagt die Meldung es, ohne den langen Namen der Auswahl zu wiederholen", () => {
    expect(treatmentIssues("drittland", { rates: [1900] })).toEqual(["Bei der gewählten Umsatzsteuer müssen alle Positionen 0 % haben"]);
  });

  it("regulär prüft nichts", () => {
    expect(treatmentIssues("regulaer", { rates: [1900, 0] })).toEqual([]);
  });
});

describe("Namen in der Auswahl", () => {
  it("unterscheiden sich in den ersten 30 Zeichen (am Handy sieht man nicht mehr), sind kurz und ohne Paragrafen (die stehen im Hinweis unter der Auswahl)", () => {
    const labels = Object.values(TAX_TREATMENTS).map((treatment) => treatment.label);
    expect(new Set(labels.map((label) => label.slice(0, 30))).size).toBe(labels.length);
    expect(labels.filter((label) => label.length > 60 || label.includes("§"))).toEqual([]);
  });

  it("nennen bei Auslandsleistungen auch das Nutzungsrecht, nicht nur die Dienstleistung (§ 3 Abs. 9 UStG)", () => {
    for (const key of ["reverse_charge", "drittland", "eu_sonstige"] as const) {
      expect(TAX_TREATMENTS[key].label).toContain("Dienstleistung oder Nutzungsrecht");
    }
  });
});

describe("inEuVatArea", () => {
  it("Mitgliedstaaten und Monaco, nicht die Schweiz, Liechtenstein oder Großbritannien", () => {
    expect(["DE", "FR", "ie", "MC"].map(inEuVatArea)).toEqual([true, true, true, true]);
    expect(["CH", "LI", "GB", "AD", ""].map(inEuVatArea)).toEqual([false, false, false, false, false]);
  });
});

describe("treatmentNote", () => {
  it("trennt die geklärte EU-B2C-Leistung von B2B-Reverse-Charge", () => {
    // § 3a Abs. 3 Nr. 3 UStG: Ein geklärter ausländischer Leistungsort ist kein Nachweis für B2B-Reverse-Charge.
    // https://www.gesetze-im-internet.de/ustg_1980/__3a.html
    expect(TAX_TREATMENTS).toHaveProperty("eu_sonstige.category", "O");
    expect(TAX_TREATMENTS).toHaveProperty("eu_sonstige.reasonCode", "VATEX-EU-O");
  });

  it("eigener Text vor Standardtext", () => {
    expect(treatmentNote("regulaer")).toBeNull();
    expect(treatmentNote("kleinunternehmer")).toContain("§ 19 UStG");
    expect(treatmentNote("steuerfrei", " Steuerfrei nach § 4 Nr. 21 UStG ")).toBe("Steuerfrei nach § 4 Nr. 21 UStG");
  });
});
