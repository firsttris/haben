import { describe, expect, it } from "vitest";
import { EInvoiceParseError, parseEInvoiceXml, readEInvoice } from "./incoming.ts";

const ubl = (sellerName: string, issueDate = "2026-10-01") => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>R-1</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>${sellerName}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>
    <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

describe("parseEInvoiceXml (Review)", () => {
  it("weist ein Kalenderdatum zurück, das es nicht gibt (30.02.)", () => {
    expect(() => parseEInvoiceXml(ubl("Lieferant GmbH", "2026-02-30"))).toThrow(EInvoiceParseError);
  });
});

describe("readEInvoice (Review)", () => {
  it("liest eine als XML hochgeladene Datei als XML, auch wenn im Text „%PDF-“ vorkommt", async () => {
    const xml = ubl("Scan %PDF-Service GmbH");
    const read = await readEInvoice({ bytes: Buffer.from(xml), mimeType: "application/xml", filename: "rechnung.xml" });
    expect(read?.invoice.seller.name).toBe("Scan %PDF-Service GmbH");
  });
});
