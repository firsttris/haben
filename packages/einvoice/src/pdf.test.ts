import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { logoFormat, pdfData, renderInvoicePdf, templateInputs } from "./pdf.ts";
import { grossPriceLines, mixedRateLines, sampleDocument, zeroRateLines } from "./samples.ts";
import { accentPalette, DEFAULT_ACCENT } from "@haben/core";

const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Entpackte Inhaltsströme eines PDFs, um Zeichenbefehle wie Farben zu finden */
function contentStreams(pdf: Uint8Array): string {
  const text = ascii(pdf);
  return [...text.matchAll(/stream\r?\n/g)]
    .map((match) => {
      const start = match.index + match[0].length;
      try {
        return inflateSync(pdf.subarray(start, text.indexOf("endstream", start))).toString("latin1");
      } catch {
        return "";
      }
    })
    .join("\n");
}

describe("renderInvoicePdf", () => {
  it("erzeugt ein PDF/A-3b", () => {
    const pdf = renderInvoicePdf(sampleDocument());
    expect(pdf.byteLength).toBeGreaterThan(5000);
    expect(ascii(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(ascii(pdf)).toContain("<pdfaid:part>3</pdfaid:part>");
  });

  it("übernimmt Nutzertext unverändert, ohne Typst-Markup auszuwerten", () => {
    const doc = sampleDocument({ intro: '#panic("y") = Überschrift', note: '#panic("x") *fett* $x$ ]' });
    doc.lines[0]!.description = 'Beratung #read("/etc/passwd") _kursiv_ \\';
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

describe("Akzentfarbe", () => {
  it("setzt ohne Einstellung die Standardfarbe und das Logo als Dateinamen", () => {
    expect(templateInputs({ title: "Rechnung" }, {})).toMatchObject({ title: "Rechnung", accent: DEFAULT_ACCENT, palette: accentPalette(DEFAULT_ACCENT) });
    expect(templateInputs({ title: "Rechnung" }, {})).not.toHaveProperty("logo");
    expect(templateInputs({}, { accent: "#0055AA", logo: { data: new Uint8Array(), format: "png" } })).toMatchObject({
      accent: "#0055AA",
      palette: accentPalette("#0055AA"),
      logo: "logo.png",
    });
  });

  it("zeichnet Überschriften und Linien in der eingestellten Farbe", () => {
    // #0055AA = RGB 0, 85, 170 → 0 0,333 0,667
    const blau = /0 0\.3333\d* 0\.6666\d* (scn|SCN)/;
    expect(contentStreams(renderInvoicePdf({ ...sampleDocument(), accent: "#0055AA" }))).toMatch(blau);
    expect(contentStreams(renderInvoicePdf(sampleDocument()))).not.toMatch(blau);
  });

  it("färbt auch Text, Adressen, Positionen und Fußzeile passend statt grün (#222)", () => {
    // Fließtext #16211C ab Werk = 0,086 0,129 0,110; bei Blau der abgeleitete Grauton statt dieses Grüns
    const gruenerText = /0\.08627\d* 0\.12941\d* 0\.10980\d* (scn|SCN)/;
    const { ink } = accentPalette("#0055AA");
    const [r, g, b] = [1, 3, 5].map((i) => (parseInt(ink.slice(i, i + 2), 16) / 255).toFixed(3).slice(0, 4));
    const blauerText = new RegExp(`${r}\\d* ${g}\\d* ${b}\\d* (scn|SCN)`);
    const blau = contentStreams(renderInvoicePdf({ ...sampleDocument(), accent: "#0055AA" }));
    expect(contentStreams(renderInvoicePdf(sampleDocument()))).toMatch(gruenerText);
    expect(blau).not.toMatch(gruenerText);
    expect(blau).toMatch(blauerText);
  });
});

describe("pdfData", () => {
  it("gibt die Beschreibung einer Position getrimmt mit, leer als null", () => {
    const doc = sampleDocument();
    doc.lines[0]!.detail = "  Konzeption und Umsetzung\nlaut Rahmenvertrag  ";
    doc.lines[1]!.detail = "   ";
    const data = pdfData(doc);
    expect(data.lines[0]).toMatchObject({ description: "Softwareentwicklung September", detail: "Konzeption und Umsetzung\nlaut Rahmenvertrag" });
    expect(data.lines[1]!.detail).toBeNull();
    expect(() => renderInvoicePdf(doc)).not.toThrow();
  });

  it("übernimmt Einleitung und Hinweis getrimmt, leer als null", () => {
    const data = pdfData(sampleDocument({ intro: "  Sehr geehrte Damen und Herren,\nwir berechnen:  ", note: "Vielen Dank." }));
    expect(data.intro).toBe("Sehr geehrte Damen und Herren,\nwir berechnen:");
    expect(data.note).toBe("Vielen Dank.");
    expect(pdfData(sampleDocument({ intro: "   " })).intro).toBeNull();
  });

  it("rendert ein PDF mit mehrzeiliger Einleitung", () => {
    expect(() => renderInvoicePdf(sampleDocument({ intro: "Bestellnummer 4500123456\nProjekt Phoenix" }))).not.toThrow();
  });

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
    expect(data.totals.rows.map((r) => r.label)).toEqual(["Summe netto", "Umsatzsteuer 19 % auf -2.486,25\u00a0€", "Umsatzsteuer 7 % auf -149,70\u00a0€"]);
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

describe("pdfData in Fremdwährung", () => {
  it("Beträge in der Währung der Rechnung, Umsatzsteuer zusätzlich in Euro, kein GiroCode", () => {
    const data = pdfData({
      ...sampleDocument({ lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }] }),
      currency: "USD",
      euroTax: { tax: 1757, taxes: [{ rate: 1900, tax: 1757 }], rate: "1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)" },
    });
    expect(data.totals.gross.value).toBe("119,00 USD");
    expect(data.totals.euroTax).toEqual({
      label: "Umsatzsteuer in Euro, 1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)",
      rows: [{ label: "Umsatzsteuer 19 %", value: "17,57 €" }],
    });
    expect(data.qr).toBeNull();
  });
});
