import { describe, expect, it } from "vitest";
import { pdfData, renderInvoicePdf } from "./pdf.ts";
import { mixedRateLines, sampleDocument } from "./samples.ts";

const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("renderInvoicePdf", () => {
  it("erzeugt ein PDF/A-3b", () => {
    const pdf = renderInvoicePdf(sampleDocument());
    expect(pdf.byteLength).toBeGreaterThan(5000);
    expect(ascii(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(ascii(pdf)).toContain("<pdfaid:part>3</pdfaid:part>");
  });

  it("übernimmt Nutzertext unverändert, ohne Typst-Markup auszuwerten", () => {
    const doc = sampleDocument({ note: '#panic("x") *fett* $x$ ]' });
    doc.lines[0]!.description = "Beratung #read(\"/etc/passwd\") _kursiv_ \\";
    expect(() => renderInvoicePdf(doc)).not.toThrow();
  });
});

describe("pdfData", () => {
  it("formatiert Rechnungsangaben deutsch", () => {
    const data = pdfData(sampleDocument());
    expect(data.title).toBe("Rechnung");
    expect(data.meta).toContainEqual({ label: "Rechnungsnummer", value: "2026-034" });
    expect(data.meta).toContainEqual({ label: "Leistungszeitraum", value: "01.09.2026 – 30.09.2026" });
    expect(data.meta).toContainEqual({ label: "Kundennummer", value: "K-1007" });
    expect(data.lines[0]).toMatchObject({ quantity: "152 Std.", unitPrice: "95,00\u00a0€", rate: "19 %", net: "14.440,00\u00a0€" });
    expect(data.totals.gross.value).toBe("17.409,58\u00a0€");
    expect(data.payment).toBe("Bitte überweisen Sie den Betrag bis zum 16.10.2026 unter Angabe der Rechnungsnummer.");
    expect(data.footer[1]).toContain("IBAN DE89 3704 0044 0532 0130 00");
    expect(data.footer[2]).toEqual(["Steuernummer 13/345/67890", "USt-IdNr. DE123456789"]);
  });

  it("weist bei Storno die Bezugsrechnung und Steuer je Satz aus", () => {
    const data = pdfData(sampleDocument({ kind: "storno", lines: mixedRateLines }));
    expect(data.title).toBe("Stornorechnung");
    expect(data.reference).toBe("zur Rechnung 2026-034 vom 30.09.2026");
    expect(data.payment).toBe("Der Betrag wird Ihnen erstattet.");
    // Kein GiroCode für Erstattungen
    expect(data.qr).toBeNull();
    expect(data.totals.rows.map((r) => r.label)).toEqual([
      "Summe netto",
      "Umsatzsteuer 19 % auf -2.486,25\u00a0€",
      "Umsatzsteuer 7 % auf -149,70\u00a0€",
    ]);
  });

  it("druckt einen GiroCode über den Rechnungsbetrag, nur mit IBAN", () => {
    const data = pdfData(sampleDocument());
    expect(data.qr).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
    const ohneKonto = sampleDocument();
    delete ohneKonto.seller.iban;
    expect(pdfData(ohneKonto).qr).toBeNull();
  });

  it("nennt das Leistungsdatum, wenn kein Zeitraum vorliegt", () => {
    const doc = { ...sampleDocument(), serviceFrom: undefined, serviceTo: undefined };
    expect(pdfData(doc).meta).toContainEqual({ label: "Leistungsdatum", value: "entspricht Rechnungsdatum" });
  });
});
