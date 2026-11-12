import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { euBuyer, sampleBuyer, sampleDocument, zeroRateLines } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false });

describe("Leistungszeitraum in der E-Rechnung", () => {
  // Factur-X 1.08, BR-FX-EN-04: ohne BT-72 muss der Pflicht-Lieferblock Inhalt haben.
  // https://github.com/akretion/factur-x/blob/57de7ed112a71fbcff77c32cf2c6ccba8c6469b1/src/facturx/xsd/facturx-en16931/Factur-X_1.08_EN16931-compiled.xsl#L4489-L4502
  it.each((["zugferd", "xrechnung-cii"] as const).flatMap((format) => (["rechnung", "storno", "korrektur"] as const).map((kind) => ({ format, kind }))))(
    "$format/$kind: Lieferland statt leerem Lieferblock, Zeitraum und Beträge bleiben erhalten",
    async ({ format, kind }) => {
      const doc = {
        ...sampleDocument({
          format,
          kind,
          buyer: { ...sampleBuyer, land: "de" },
          lines: [{ description: "Leistungspaket", quantity: 1000, unit: "Psch.", unitPrice: 10000, taxRate: 1900 }],
        }),
        serviceFrom: "2026-10-01",
        serviceTo: "2026-10-31",
      };
      const { xml } = await buildEInvoice(doc);
      const tx = parser.parse(xml).CrossIndustryInvoice.SupplyChainTradeTransaction;
      expect(tx.ApplicableHeaderTradeDelivery).toEqual({
        ShipToTradeParty: {
          PostalTradeAddress: {
            PostcodeCode: "20457",
            LineOne: "Hafenweg 3",
            CityName: "Hamburg",
            CountryID: "DE",
          },
        },
      });
      expect(tx.ApplicableHeaderTradeSettlement).toMatchObject({
        BillingSpecifiedPeriod: {
          StartDateTime: { DateTimeString: "20261001" },
          EndDateTime: { DateTimeString: "20261031" },
        },
        SpecifiedTradeSettlementHeaderMonetarySummation: {
          LineTotalAmount: "100.00",
          TaxBasisTotalAmount: "100.00",
          TaxTotalAmount: "19.00",
          GrandTotalAmount: "119.00",
          DuePayableAmount: "119.00",
        },
      });
    },
  );

  it.each([
    { serviceFrom: "2026-10-31", serviceTo: "2026-10-31" },
    { serviceFrom: "2026-10-31", serviceTo: undefined },
    { serviceFrom: undefined, serviceTo: "2026-10-31" },
    { serviceFrom: undefined, serviceTo: undefined },
  ])("einzelnes Leistungsdatum bleibt BT-72 ($serviceFrom/$serviceTo)", async (period) => {
    const doc = { ...sampleDocument(), ...period };
    const { xml } = await buildEInvoice(doc);
    const tx = parser.parse(xml).CrossIndustryInvoice.SupplyChainTradeTransaction;
    expect(tx.ApplicableHeaderTradeDelivery).toEqual({
      ActualDeliverySupplyChainEvent: { OccurrenceDateTime: { DateTimeString: period.serviceFrom || period.serviceTo ? "20261031" : "20261002" } },
    });
    expect(tx.ApplicableHeaderTradeSettlement).not.toHaveProperty("BillingSpecifiedPeriod");
  });

  it.each(["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const)("%s: innergemeinschaftliche Lieferung behält das Bestimmungsland", async (format) => {
    const { xml } = await buildEInvoice(sampleDocument({ format, buyer: euBuyer, lines: zeroRateLines, taxTreatment: "ig_lieferung" }));
    if (format === "xrechnung-ubl") {
      expect(parser.parse(xml).Invoice.Delivery.DeliveryLocation.Address.Country.IdentificationCode).toBe("AT");
    } else {
      const tx = parser.parse(xml).CrossIndustryInvoice.SupplyChainTradeTransaction;
      expect(tx.ApplicableHeaderTradeDelivery.ShipToTradeParty.PostalTradeAddress.CountryID).toBe("AT");
      expect(tx.ApplicableHeaderTradeDelivery).not.toHaveProperty("ActualDeliverySupplyChainEvent");
    }
  });

  it("XRechnung UBL übernimmt die Lieferanschrift und behält Zeitraum und Beträge", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl" }));
    const invoice = parser.parse(xml).Invoice;
    expect(invoice.InvoicePeriod).toEqual({ StartDate: "2026-09-01", EndDate: "2026-09-30" });
    expect(invoice.LegalMonetaryTotal).toMatchObject({ TaxExclusiveAmount: "14629.90", TaxInclusiveAmount: "17409.58", PayableAmount: "17409.58" });
    expect(invoice.Delivery).toEqual({
      DeliveryLocation: {
        Address: {
          StreetName: "Hafenweg 3",
          CityName: "Hamburg",
          PostalZone: "20457",
          Country: { IdentificationCode: "DE" },
        },
      },
    });
    expect(invoice).not.toHaveProperty("Delivery.ActualDeliveryDate");
  });
});
