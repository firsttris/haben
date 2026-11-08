import { DEFAULT_OPTIONS, type LetterheadOptions } from "@haben/core";
import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { pdfData, renderInvoicePdf, templateInputs } from "./pdf.ts";
import { mixedRateLines, sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { buildEInvoice } from "./index.ts";
import { quotePdfData } from "./quote.ts";

/** Schalter der Gestaltung (#113): Sie ändern das Blatt, nie die Pflichtangaben oder das XML */
const withOptions = (changes: Partial<LetterheadOptions>, sample: Parameters<typeof sampleDocument>[0] = {}) => ({
  ...sampleDocument(sample),
  options: { ...DEFAULT_OPTIONS, ...changes },
});

const labels = (data: { meta: { label: string }[] }) => data.meta.map((m) => m.label);

describe("Spalte USt im Angebot", () => {
  const quote = (optionalRate: number) => {
    const sample = sampleDocument();
    const [first] = sample.lines;
    return quotePdfData({
      number: "AN-2026-007",
      issueDate: "2026-09-01",
      validUntil: "2026-10-01",
      seller: sampleSeller,
      buyer: sampleBuyer,
      lines: [{ ...first! }, { ...first!, description: "Option", taxRate: optionalRate, kind: "optional" }],
      totals: { ...sample.totals, taxes: sample.totals.taxes.slice(0, 1) },
      options: { ...DEFAULT_OPTIONS, vatColumn: false },
    });
  };

  it("bleibt stehen, wenn nur eine optionale Position einen anderen Steuersatz hat", () => {
    expect(quote(700).hideVatColumn).toBe(false);
  });

  it("entfällt, wenn auch die optionale Position denselben Steuersatz hat", () => {
    expect(quote(1900).hideVatColumn).toBe(true);
  });
});

describe("Schalter der Gestaltung im PDF", () => {
  it("ab Werk bleibt alles wie bisher", () => {
    const data = pdfData(sampleDocument());
    expect(labels(data)).toContain("Kundennummer");
    expect(data.qr).not.toBeNull();
    expect(data.hideVatColumn).toBe(false);
  });

  it("blendet die Kundennummer im PDF aus, das XML nennt sie weiter", async () => {
    const doc = withOptions({ customerNumber: false });
    expect(labels(pdfData(doc))).not.toContain("Kundennummer");
    const { xml } = await buildEInvoice(doc);
    expect(xml).toContain(sampleBuyer.kundennummer!);
  });

  it("lässt den GiroCode weg", () => {
    expect(pdfData(withOptions({ giroCode: false })).qr).toBeNull();
  });

  it("nimmt die Spalte USt nur bei einem einzigen Steuersatz heraus", () => {
    expect(pdfData(withOptions({ vatColumn: false })).hideVatColumn).toBe(true);
    expect(pdfData(withOptions({ vatColumn: false }, { lines: mixedRateLines })).hideVatColumn).toBe(false);
  });

  it("die Summen nennen den Steuersatz auch ohne Spalte", () => {
    expect(
      pdfData(withOptions({ vatColumn: false }))
        .totals.rows.map((row) => row.label)
        .join(" "),
    ).toMatch(/Umsatzsteuer 19\s?%/);
  });

  it("gibt Größe und Seite des Logos und die Marken an die Vorlage", () => {
    expect(templateInputs({}, {})).toMatchObject({ look: { logoHeight: 18, logoWidth: 60, logoLeft: false, foldMarks: true } });
    expect(templateInputs({}, { options: { ...DEFAULT_OPTIONS, logoSize: "l", logoPosition: "links", foldMarks: false } })).toMatchObject({
      look: { logoHeight: 24, logoWidth: 80, logoLeft: true, foldMarks: false },
    });
  });

  it("die Mahnung folgt denselben Schaltern", () => {
    const doc = {
      level: 1 as const,
      date: "2026-10-15",
      dueDate: "2026-10-25",
      seller: sampleSeller,
      buyer: sampleBuyer,
      invoice: { number: "2026-001", issueDate: "2026-09-01", dueDate: "2026-09-15" },
      amounts: { open: 119_000, fee: 0, flatFee: 0, interest: 0, interestRate: 0, interestDays: 0, total: 119_000 },
      intro: "Bitte zahlen.",
      closing: "",
    };
    expect(dunningPdfData(doc).qr).not.toBeNull();
    expect(labels(dunningPdfData(doc))).toContain("Kundennummer");
    const off = dunningPdfData({ ...doc, options: { ...DEFAULT_OPTIONS, giroCode: false, customerNumber: false } });
    expect(off.qr).toBeNull();
    expect(labels(off)).not.toContain("Kundennummer");
  });

  it("die Vorlage übersetzt jede Kombination zu einem PDF", () => {
    const pdf = (changes: Partial<LetterheadOptions>) => renderInvoicePdf(withOptions(changes));
    const standard = pdf({});
    const ohneMarken = pdf({ foldMarks: false });
    const ohneSpalte = pdf({ vatColumn: false });
    expect(Buffer.from(standard.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(Buffer.compare(Buffer.from(standard), Buffer.from(ohneMarken))).not.toBe(0);
    expect(Buffer.compare(Buffer.from(standard), Buffer.from(ohneSpalte))).not.toBe(0);
  });
});
