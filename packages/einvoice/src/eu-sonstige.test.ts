import { describe, expect, it } from "vitest";
import { sampleDocument, zeroRateLines } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

describe("EU-Leistung mit bestätigtem ausländischem Leistungsort", () => {
  // EN16931 BR-O-02: Kategorie O darf keine VAT-Identifikation von Lieferer oder Erwerber enthalten.
  it.each(["xrechnung-ubl", "xrechnung-cii"] as const)("schreibt Kategorie O ohne VAT-Kennungen in %s", async (format) => {
    const doc = sampleDocument({ format, lines: zeroRateLines, taxTreatment: "eu_sonstige" });
    const { xml } = await buildEInvoice(doc);
    expect(xml).not.toContain('schemeID="VA"');
    expect(xml).not.toContain("<cbc:CompanyID>DE123456789</cbc:CompanyID>");
    if (format === "xrechnung-ubl") {
      // Das Steuerschema VAT an den Steuerkategorien bleibt erforderlich; BR-O-02 betrifft die Parteienkennungen.
      const parties = xml.match(/<cac:Accounting(?:Supplier|Customer)Party>[\s\S]*?<\/cac:Accounting(?:Supplier|Customer)Party>/g) ?? [];
      expect(parties).toHaveLength(2);
      expect(parties.join("\n")).not.toContain("<cbc:ID>VAT</cbc:ID>");
    }
    expect(xml).toContain("VATEX-EU-O");
  });
});
