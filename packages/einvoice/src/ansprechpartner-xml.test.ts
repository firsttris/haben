import { describe, expect, it } from "vitest";
import { sampleBuyer, sampleDocument } from "./samples.ts";
import type { Buyer, InvoiceFormat } from "./types.ts";
import { buildEInvoice } from "./xml.ts";

/*
 * Ansprechpartner des Käufers (#424) als BT-56 „Buyer contact point“ (EN 16931-1): UBL cac:AccountingCustomerParty/
 * cac:Party/cac:Contact/cbc:Name, CII ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/
 * ram:PersonName; XRechnung 3.0 und ZUGFeRD 2.x übernehmen es unverändert. Die E-Mail des Kontakts bleibt BT-58, wie bisher
 * ohne Ansprechpartner. Telefon, E-Mail und Funktion der Person stehen nicht im XML. Alle Namen sind erfunden.
 */

const person: Buyer = {
  ...sampleBuyer,
  ansprechpartner: { name: "Mara Beispiel", email: "mara@nordwerk.example", telefon: "+49 40 7654321", funktion: "Einkauf" },
};
const FORMATS: InvoiceFormat[] = ["zugferd", "xrechnung-cii", "xrechnung-ubl"];

function buyerBlock(xml: string, format: InvoiceFormat): string {
  const pattern =
    format === "xrechnung-ubl"
      ? /<cac:AccountingCustomerParty>([\s\S]*?)<\/cac:AccountingCustomerParty>/
      : /<ram:BuyerTradeParty>([\s\S]*?)<\/ram:BuyerTradeParty>/;
  return xml.match(pattern)?.[1] ?? "";
}

describe("Ansprechpartner in der E-Rechnung (BT-56)", () => {
  it.each(FORMATS)("schreibt den Namen als BT-56 am Käufer (%s)", async (format) => {
    const { xml } = await buildEInvoice(sampleDocument({ format, buyer: person }));
    const block = buyerBlock(xml, format);
    if (format === "xrechnung-ubl") {
      expect(block).toMatch(/<cac:Contact>\s*<cbc:Name>Mara Beispiel<\/cbc:Name>/);
    } else {
      expect(block).toMatch(/<ram:DefinedTradeContact>\s*<ram:PersonName>Mara Beispiel<\/ram:PersonName>/);
    }
    // Nur der Name: Die E-Mail der Person, ihr Telefon und die Funktion gehören nicht in die Datei
    expect(xml).not.toMatch(/mara@nordwerk|7654321|Einkauf/);
    // Der Name steht einmal beim Käufer
    expect(xml.split("Mara Beispiel").length - 1).toBe(1);
  });

  it.each(FORMATS)("ohne Ansprechpartner bleibt der Käufer wie bisher, die Kontakt-E-Mail ist weiter BT-58 (%s)", async (format) => {
    const { xml } = await buildEInvoice(sampleDocument({ format, buyer: sampleBuyer }));
    const block = buyerBlock(xml, format);
    expect(block).not.toMatch(/PersonName|<cbc:Name>/);
    expect(block).toContain(sampleBuyer.email!);
  });

  it.each(FORMATS)("mit Ansprechpartner steht die Kontakt-E-Mail weiter als BT-58 (%s)", async (format) => {
    const { xml } = await buildEInvoice(sampleDocument({ format, buyer: person }));
    expect(buyerBlock(xml, format)).toContain(sampleBuyer.email!);
  });
});
