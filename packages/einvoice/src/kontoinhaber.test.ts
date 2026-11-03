import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { footerColumns, pdfData } from "./pdf.ts";
import { girocodeSvg } from "./qr.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";
import { dunningAmounts } from "@haben/core";

// Konto auf die Person, Firma unter eigenem Namen: GiroCode und E-Rechnung brauchen den Namen des Kontoinhabers,
// sonst warnt die Empfängerüberprüfung (Verification of Payee) beim Überweisen (#223)
const seller = { ...sampleSeller, kontoinhaber: "Max Mustermann" };
const girocode = (name: string, amount: number, text: string) =>
  girocodeSvg({ name, iban: seller.iban!, ...(seller.bic ? { bic: seller.bic } : {}), amount, text });

describe("Kontoinhaber", () => {
  it("steht im GiroCode der Rechnung, ohne Angabe wie bisher der Firmenname", () => {
    const doc = { ...sampleDocument(), seller };
    expect(pdfData(doc).qr).toBe(girocode("Max Mustermann", doc.totals.gross, `Rechnung ${doc.number}`));
    const ohne = sampleDocument();
    expect(pdfData(ohne).qr).toBe(girocode(sampleSeller.name, ohne.totals.gross, `Rechnung ${ohne.number}`));
  });

  it("steht in der Bankspalte der Fußzeile, nur wenn er vom Firmennamen abweicht", () => {
    expect(footerColumns(seller)[1]).toContain("Kontoinhaber Max Mustermann");
    expect(footerColumns(sampleSeller)[1]!.join(" ")).not.toContain("Kontoinhaber");
    expect(footerColumns({ ...sampleSeller, kontoinhaber: sampleSeller.name })[1]!.join(" ")).not.toContain("Kontoinhaber");
  });

  it("ist im XML der Name des Zahlungskontos (BT-85), ohne Angabe der Firmenname", async () => {
    const { xml } = await buildEInvoice({ ...sampleDocument(), seller, format: "xrechnung-cii" });
    expect(xml).toMatch(/<ram:PayeePartyCreditorFinancialAccount>[\s\S]*?<ram:AccountName>Max Mustermann<\/ram:AccountName>/);
    const ubl = await buildEInvoice({ ...sampleDocument(), seller, format: "xrechnung-ubl" });
    expect(ubl.xml).toMatch(/<cac:PayeeFinancialAccount>[\s\S]*?<cbc:Name>Max Mustermann<\/cbc:Name>/);
    const ohne = await buildEInvoice({ ...sampleDocument(), format: "xrechnung-ubl" });
    expect(ohne.xml).toMatch(new RegExp(`<cac:PayeeFinancialAccount>[\\s\\S]*?<cbc:Name>${sampleSeller.name}</cbc:Name>`));
  });

  it("steht im GiroCode der Mahnung", () => {
    const amounts = dunningAmounts({ open: 100_000, dueDate: "2026-09-16", date: "2026-10-16", fee: 0, flatFee: false, interestRate: null });
    const data = dunningPdfData({
      level: 1,
      date: "2026-10-16",
      dueDate: "2026-10-26",
      seller,
      buyer: sampleBuyer,
      invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
      amounts,
      intro: "",
      closing: "",
    });
    expect(data.qr).toBe(girocode("Max Mustermann", amounts.total, "Rechnung 2026-034"));
  });
});
