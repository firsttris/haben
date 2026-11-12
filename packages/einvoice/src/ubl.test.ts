import { describe, expect, it } from "vitest";
import type { Invoice } from "./modell.ts";
import { sampleDocument } from "./samples.ts";
import { ublXml } from "./ubl.ts";
import { toEInvoiceData } from "./xml.ts";

describe("ublXml", () => {
  // Ein Feld ohne Platz in der Reihenfolge des Schemas fiele sonst still aus dem XML
  it("lehnt ein Feld ab, das keinen Platz in der Reihenfolge hat", () => {
    const invoice = toEInvoiceData(sampleDocument({ format: "xrechnung-ubl" }));
    expect(() => ublXml({ ...invoice, "cbc:AccountingCost": "4711" } as Invoice)).toThrow("UBL: cbc:AccountingCost in Invoice hat keinen Platz");
    const party = invoice["cac:AccountingSupplierParty"]["cac:Party"];
    const withPartyName = { ...invoice, "cac:AccountingSupplierParty": { "cac:Party": { ...party, "cac:PartyName": { "cbc:Name": "X" } } } };
    expect(() => ublXml(withPartyName as Invoice)).toThrow("UBL: cac:PartyName in cac:Party hat keinen Platz");
  });
});
