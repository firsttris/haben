import { readFileSync } from "node:fs";
import { UNITS } from "@haben/core";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractEmbeddedXml, MAX_EMBEDDED_BYTES } from "./embedded.ts";
import { EInvoiceParseError, parseDecimal, parseEInvoiceXml, readEInvoice } from "./incoming.ts";
import { mixedRateLines, sampleDocument } from "./samples.ts";
import type { InvoiceFormat, InvoiceKind } from "./types.ts";
import { buildEInvoice } from "./xml.ts";

const fixture = (name: string) => readFileSync(new URL(`../test-fixtures/incoming/${name}`, import.meta.url), "utf8");
const byRate = <T extends { rate: number }>(taxes: T[]) => [...taxes].sort((a, b) => b.rate - a.rate);

async function pdfWith(attachments: { name: string; content: string }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  for (const { name, content } of attachments) {
    await doc.attach(Buffer.from(content, "utf8"), name, { mimeType: "text/xml", description: "Rechnung" });
  }
  return doc.save();
}

describe("parseDecimal", () => {
  it("rechnet exakt in ganzen Einheiten", () => {
    expect(parseDecimal("1234.5", 2, true)).toBe(123450);
    expect(parseDecimal("-0.07", 2, true)).toBe(-7);
    expect(parseDecimal("100.000", 2, true)).toBe(10000);
    expect(parseDecimal(".5", 2, true)).toBe(50);
    expect(parseDecimal("12.3456", 2, false)).toBe(1235);
    expect(parseDecimal("-12.345", 2, false)).toBe(-1235);
    expect(parseDecimal("12.5", 3, false)).toBe(12500);
    expect(() => parseDecimal("12.345", 2, true)).toThrow(EInvoiceParseError);
    expect(() => parseDecimal("1,50", 2, true)).toThrow(EInvoiceParseError);
  });
});

describe("eigene E-Rechnungen zurücklesen", () => {
  const cases: { kind: InvoiceKind; format: InvoiceFormat; mixed: boolean }[] = [
    { kind: "rechnung", format: "zugferd", mixed: false },
    { kind: "rechnung", format: "xrechnung-cii", mixed: true },
    { kind: "rechnung", format: "xrechnung-ubl", mixed: true },
    { kind: "storno", format: "zugferd", mixed: true },
    { kind: "storno", format: "xrechnung-cii", mixed: false },
    { kind: "storno", format: "xrechnung-ubl", mixed: true },
    { kind: "korrektur", format: "zugferd", mixed: false },
    { kind: "korrektur", format: "xrechnung-ubl", mixed: false },
  ];

  it.each(cases)("$kind als $format (gemischte Sätze: $mixed)", async ({ kind, format, mixed }) => {
    const doc = sampleDocument({ kind, format, lines: mixed ? mixedRateLines : undefined });
    const { xml, pdf } = await buildEInvoice(doc);
    const read =
      format === "zugferd"
        ? await readEInvoice({ bytes: pdf, mimeType: "application/pdf", filename: `${doc.number}.pdf` })
        : await readEInvoice({ bytes: Buffer.from(xml), mimeType: "application/xml", filename: `${doc.number}.xml` });
    expect(read).not.toBeNull();
    const { invoice, source } = read!;
    expect(read!.xml).toBe(xml);
    expect(source).toBe(format === "zugferd" ? "zugferd" : "xrechnung");
    expect(invoice.syntax).toBe(format === "xrechnung-ubl" ? "ubl" : "cii");
    expect(invoice.typeCode).toBe(kind === "rechnung" ? "380" : "381");
    expect(invoice.isCreditNote).toBe(kind !== "rechnung");
    // Gutschriften schreiben wir ohne Fälligkeit und Bankverbindung
    const credit = kind !== "rechnung";
    const iban = credit ? undefined : doc.seller.iban;
    expect(invoice).toMatchObject({
      number: doc.number,
      issueDate: doc.issueDate,
      dueDate: credit ? undefined : doc.dueDate,
      currency: "EUR",
      serviceFrom: doc.serviceFrom,
      serviceTo: doc.serviceTo,
      net: doc.totals.net,
      tax: doc.totals.tax,
      gross: doc.totals.gross,
      duePayable: doc.totals.gross,
      iban,
    });
    expect(invoice.seller).toMatchObject({
      name: doc.seller.name,
      ustId: doc.seller.ustId,
      steuernummer: doc.seller.steuernummer,
      strasse: doc.seller.strasse,
      plz: doc.seller.plz,
      ort: doc.seller.ort,
      land: doc.seller.land,
      email: doc.seller.email,
      iban,
    });
    expect(byRate(invoice.taxes).map(({ rate, base, tax }) => ({ rate, base, tax }))).toEqual(byRate(doc.totals.taxes));
    expect(invoice.taxes.every((t) => t.category === "S")).toBe(true);
    expect(invoice.lines.map((l) => ({ ...l, quantity: Math.abs(l.quantity) }))).toEqual(
      doc.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitCode: UNITS[l.unit], net: l.net, taxRate: l.taxRate })),
    );
    if (credit) expect(invoice.gross).toBeLessThan(0);
  });
});

describe("parseEInvoiceXml mit Fremdrechnungen", () => {
  it("liest CII mit beliebigen Namensraumpräfixen", () => {
    const invoice = parseEInvoiceXml(fixture("cii-prefixes.xml"));
    expect(invoice).toEqual({
      syntax: "cii",
      typeCode: "380",
      isCreditNote: false,
      number: "RE-2026/0815",
      issueDate: "2026-09-15",
      dueDate: "2026-09-29",
      currency: "EUR",
      seller: {
        name: "Netzwerk Hosting GmbH",
        ustId: "DE987654321",
        steuernummer: "143/123/45678",
        strasse: "Marienplatz 8",
        plz: "80331",
        ort: "München",
        land: "DE",
        email: "billing@netzwerk-hosting.example",
        iban: "DE02120300000000202051",
      },
      buyerReference: "04011000-12345-34",
      serviceFrom: "2026-08-01",
      serviceTo: "2026-08-31",
      taxes: [
        { rate: 1900, category: "S", base: 15432, tax: 2932 },
        { rate: 700, category: "S", base: 2990, tax: 209 },
      ],
      net: 18422,
      tax: 3141,
      gross: 21563,
      duePayable: 20000,
      lines: [
        { description: "Webhosting & Domain „Business“", quantity: 12500, unitCode: "MON", net: 15432, taxRate: 1900 },
        { description: "Handbuch", quantity: 1000, unitCode: "H87", net: 2990, taxRate: 700 },
      ],
      paymentReference: "RE-2026/0815 K4711",
      iban: "DE02120300000000202051",
    });
  });

  it("liest ZUGFeRD 2 BASIC WL ohne Positionen und lässt negative 380 unverändert", () => {
    const invoice = parseEInvoiceXml(fixture("zugferd2-basicwl.xml"));
    expect(invoice).toMatchObject({
      typeCode: "380",
      isCreditNote: false,
      number: "4711-B",
      issueDate: "2026-10-01",
      dueDate: undefined,
      serviceFrom: undefined,
      seller: { name: "Bürobedarf Schulze e.K.", ustId: "DE111222333", plz: "04109" },
      taxes: [
        { rate: 1900, category: "S", base: -1000, tax: -190 },
        { rate: 0, category: "Z", base: 500, tax: 0 },
      ],
      net: -500,
      tax: -190,
      gross: -690,
      duePayable: -690,
      lines: [],
    });
  });

  it("liest ZUGFeRD 1.0 (CrossIndustryDocument)", () => {
    const invoice = parseEInvoiceXml(fixture("zugferd1-comfort.xml"));
    expect(invoice).toMatchObject({
      syntax: "cii",
      number: "471102",
      issueDate: "2013-03-05",
      dueDate: "2013-04-04",
      serviceFrom: "2013-03-05",
      serviceTo: "2013-03-05",
      seller: { name: "Lieferant GmbH", ustId: "DE123456789", steuernummer: "201/113/40209", plz: "80333", ort: "München" },
      taxes: [
        { rate: 700, category: "S", base: 27500, tax: 1925 },
        { rate: 1900, category: "S", base: 19800, tax: 3762 },
      ],
      net: 47300,
      tax: 5687,
      gross: 52987,
      paymentReference: "2013-471102",
      iban: "DE08700901001234567890",
    });
    expect(invoice.lines).toEqual([
      { description: "Trennblätter A4", quantity: 20000, unitCode: "C62", net: 19800, taxRate: 1900 },
      { description: "Joghurt Banane", quantity: 50000, unitCode: "C62", net: 27500, taxRate: 700 },
    ]);
  });

  it("liest UBL mit Default-Namensraum (Peppol, Reverse Charge)", () => {
    const invoice = parseEInvoiceXml(fixture("ubl-default-ns.xml"));
    expect(invoice).toMatchObject({
      syntax: "ubl",
      typeCode: "380",
      isCreditNote: false,
      number: "INV-77",
      issueDate: "2026-09-20",
      dueDate: "2026-10-20",
      buyerReference: "Projekt Alpha",
      serviceFrom: "2026-09-01",
      serviceTo: "2026-09-15",
      seller: { name: "CloudTools B.V.", ustId: "NL123456789B01", steuernummer: undefined, plz: "1015 CX", land: "NL", email: "ap@cloudtools.example" },
      taxes: [{ rate: 0, category: "AE", base: 4900, tax: 0 }],
      net: 4900,
      tax: 0,
      gross: 4900,
      duePayable: 4900,
      lines: [{ description: "Team-Abo September", quantity: 1000, unitCode: "C62", net: 4900, taxRate: 0 }],
      paymentReference: "INV-77",
      iban: "NL91ABNA0417164300",
    });
  });

  it("liest UBL-Gutschrift mit cbc als Default-Namensraum und negiert die Beträge", () => {
    const invoice = parseEInvoiceXml(fixture("ubl-creditnote-cbc-default.xml"));
    expect(invoice).toMatchObject({
      syntax: "ubl",
      typeCode: "381",
      isCreditNote: true,
      number: "GS-2026-12",
      dueDate: "2026-10-12",
      seller: {
        name: "Druckerei Nord GmbH",
        ustId: "DE222333444",
        steuernummer: "60/123/45678",
        strasse: "Am Hafen 2",
        email: "buchhaltung@druckerei.example",
      },
      taxes: [{ rate: 1900, category: "S", base: -5000, tax: -950 }],
      net: -5000,
      tax: -950,
      gross: -5950,
      duePayable: -5950,
      lines: [{ description: "Flyer DIN A6 (Fehldruck)", quantity: 500000, unitCode: "H87", net: -5000, taxRate: 1900 }],
    });
  });

  it("weist kaputtes oder fremdes XML mit EInvoiceParseError zurück", () => {
    expect(() => parseEInvoiceXml("<rsm:CrossIndustryInvoice><ram:ID>1</rsm:CrossIndustryInvoice>")).toThrow(EInvoiceParseError);
    expect(() => parseEInvoiceXml("kein xml")).toThrow(EInvoiceParseError);
    expect(() => parseEInvoiceXml("<Order><ID>1</ID></Order>")).toThrow(/Unbekanntes XML-Format <Order>/);
    expect(() => parseEInvoiceXml(fixture("ubl-default-ns.xml").replace("<cbc:ID>INV-77</cbc:ID>", ""))).toThrow(
      "Rechnungsnummer fehlt in der E-Rechnung",
    );
    expect(() => parseEInvoiceXml(fixture("ubl-default-ns.xml").replace(">49.00</cbc:TaxInclusiveAmount", ">49.001</cbc:TaxInclusiveAmount"))).toThrow(
      "mehr als 2 Nachkommastellen",
    );
  });
});

describe("eingebettete XML in PDFs", () => {
  it("findet zugferd-invoice.xml neben anderen Anhängen", async () => {
    const xml = fixture("cii-prefixes.xml");
    const pdf = await pdfWith([
      { name: "notiz.txt", content: "hallo" },
      { name: "anlage.xml", content: "<x/>" },
      { name: "zugferd-invoice.xml", content: xml },
    ]);
    expect(await extractEmbeddedXml(pdf)).toEqual({ filename: "zugferd-invoice.xml", xml });
    const read = await readEInvoice({ bytes: pdf, mimeType: "application/pdf", filename: "rechnung.pdf" });
    expect(read).toMatchObject({ source: "zugferd", invoice: { number: "RE-2026/0815", gross: 21563 } });
  });

  it("nimmt sonst die erste XML-Anlage", async () => {
    const xml = fixture("ubl-default-ns.xml");
    const pdf = await pdfWith([{ name: "Invoice INV-77.XML", content: xml }]);
    expect(await extractEmbeddedXml(pdf)).toEqual({ filename: "Invoice INV-77.XML", xml });
  });

  it("liefert null für PDFs ohne Anlage, Bilder und Nicht-PDFs", async () => {
    const plain = await pdfWith([]);
    expect(await extractEmbeddedXml(plain)).toBeNull();
    expect(await extractEmbeddedXml(Buffer.from("kein pdf"))).toBeNull();
    expect(await readEInvoice({ bytes: plain, mimeType: "application/pdf", filename: "beleg.pdf" })).toBeNull();
    expect(await readEInvoice({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg", filename: "beleg.jpg" })).toBeNull();
  });

  it("entpackt Anlagen höchstens bis zum Limit", async () => {
    const bomb = `<a>${" ".repeat(MAX_EMBEDDED_BYTES)}</a>`;
    const pdf = await pdfWith([{ name: "factur-x.xml", content: bomb }]);
    expect(pdf.length).toBeLessThan(1024 * 1024);
    expect(await extractEmbeddedXml(pdf)).toBeNull();
  });

  it("wirft bei XML-Dateien, die keine E-Rechnung sind", async () => {
    await expect(readEInvoice({ bytes: Buffer.from("<a><b></a>"), mimeType: "text/xml", filename: "x.xml" })).rejects.toThrow(EInvoiceParseError);
  });
});
