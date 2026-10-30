import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Keine KI: E-Rechnungen liest Haben selbst
vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return { ...original, extractionAvailable: () => false };
});

/** ZUGFeRD/Factur-X BASIC WL mit 19 % und zwei Nullsatz-Kategorien (Z: Nullsatz, E: steuerbefreit) */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:factur-x.eu:1p0:basicwl</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>4711-NULL</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20261001</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Bürobedarf Schulze e.K.</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>04109</ram:PostcodeCode><ram:LineOne>Markt 1</ram:LineOne><ram:CityName>Leipzig</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE111222333</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Erika Mustermann</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>19.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>100.00</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>10.00</ram:BasisAmount>
        <ram:CategoryCode>Z</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>5.00</ram:BasisAmount>
        <ram:ExemptionReason>Steuerfrei nach § 4 Nr. 8 UStG</ram:ExemptionReason>
        <ram:CategoryCode>E</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>115.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>115.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">19.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>134.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>134.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

describe.skipIf(!testDatabaseUrl)("Belege (Review)", () => {
  let documents: typeof import("./documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, exchange_rates, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
  });

  it("liest eine E-Rechnung mit zwei Nullsatz-Kategorien (Z und E): Beträge je Steuersatz zusammengefasst", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new TextEncoder().encode(XML), filename: "rechnung.xml" });
    const result = await documents.getDocument(id);
    expect(result!.document).toMatchObject({ extractionStatus: "fertig", supplierName: "Bürobedarf Schulze e.K.", gross: 13400 });
    expect(result!.amounts.map((a) => ({ taxRate: a.taxRate, net: a.net, tax: a.tax }))).toEqual([
      { taxRate: 1900, net: 10000, tax: 1900 },
      { taxRate: 0, net: 1500, tax: 0 },
    ]);
  });
});
