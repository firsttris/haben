import { describe, expect, it } from "vitest";
import { logoFormat, pdfData, renderInvoicePdf } from "./pdf.ts";
import { grossPriceLines, mixedRateLines, sampleDocument, zeroRateLines } from "./samples.ts";

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

describe("logoFormat", () => {
  it("erkennt PNG und JPEG an der Signatur", () => {
    expect(logoFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(logoFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(logoFormat(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(logoFormat(new Uint8Array())).toBeNull();
  });

  it("bettet das Logo ins PDF ein", () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const pdf = renderInvoicePdf({ ...sampleDocument(), logo: { data: png, format: "png" } });
    expect(Buffer.from(pdf).toString("latin1")).toContain("/Subtype /Image");
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
    // Kopie: sampleDocument teilt den Verkäufer mit allen anderen Tests
    ohneKonto.seller = { ...ohneKonto.seller, iban: undefined };
    expect(pdfData(ohneKonto).qr).toBeNull();
  });

  it("zeigt Bruttopreise mit „darin enthalten“ Netto und Umsatzsteuer je Satz", () => {
    const data = pdfData(sampleDocument({ lines: grossPriceLines, priceMode: "brutto" }));
    expect(data.labels.columns.net).toBe("Brutto");
    // Einzelpreis und Zeilenbetrag wie eingegeben, brutto
    expect(data.lines[1]).toMatchObject({ quantity: "7 Stk.", unitPrice: "9,80\u00a0€", rate: "19 %", net: "68,60\u00a0€" });
    expect(data.totals.rows).toEqual([]);
    expect(data.totals.gross).toEqual({ label: "Gesamtbetrag (inkl. USt)", value: "447,17\u00a0€" });
    expect(data.totals.included).toEqual({
      label: "darin enthalten",
      rows: [
        { label: "Netto 19 %", value: "275,18\u00a0€" },
        { label: "Umsatzsteuer 19 %", value: "52,29\u00a0€" },
        { label: "Netto 7 %", value: "111,87\u00a0€" },
        { label: "Umsatzsteuer 7 %", value: "7,83\u00a0€" },
      ],
    });
    // Der GiroCode fordert den Endpreis an
    expect(data.qr).not.toBeNull();
  });

  it("zeigt Bruttopreise auch auf Englisch", () => {
    const data = pdfData({ ...sampleDocument({ lines: [grossPriceLines[1]!], priceMode: "brutto" }), language: "en" });
    expect(data.labels.columns.net).toBe("Gross");
    expect(data.totals.gross.label).toBe("Total amount (incl. VAT)");
    expect(data.totals.included?.rows.map((r) => r.label)).toEqual(["Net", "VAT 19 %"]);
  });

  it("ohne Steuerausweis bleibt es bei der normalen Darstellung", () => {
    const doc = sampleDocument({ lines: zeroRateLines, taxTreatment: "kleinunternehmer", priceMode: "brutto" });
    const data = pdfData(doc);
    expect(data.labels.columns.net).toBe("Netto");
    expect(data.totals.gross.label).toBe("Gesamtbetrag");
    expect(data.totals.included).toBeNull();
  });

  it("erzeugt ein PDF mit Bruttopreisen", () => {
    const pdf = renderInvoicePdf(sampleDocument({ lines: grossPriceLines, priceMode: "brutto" }));
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("nennt das Leistungsdatum, wenn kein Zeitraum vorliegt", () => {
    const doc = { ...sampleDocument(), serviceFrom: undefined, serviceTo: undefined };
    expect(pdfData(doc).meta).toContainEqual({ label: "Leistungsdatum", value: "entspricht Rechnungsdatum" });
  });
});
