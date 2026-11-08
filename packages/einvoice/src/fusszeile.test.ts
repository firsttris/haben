import { DEFAULT_OPTIONS } from "@haben/core";
import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { footerColumns, pdfData, renderInvoicePdf } from "./pdf.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";

/** Eigene Fußzeile (#113): Spalten mit Platzhaltern statt der automatischen */
const own = (footerColumns: string[]) => ({ ...sampleDocument(), options: { ...DEFAULT_OPTIONS, footerColumns } });
const pages = (pdf: Uint8Array) =>
  Buffer.from(pdf)
    .toString("latin1")
    .match(/\/Type\s*\/Page\b/g)?.length;

describe("Eigene Fußzeile im PDF", () => {
  it("ohne eigene Spalten bleibt alles wie bisher", () => {
    expect(pdfData(sampleDocument()).footer).toEqual(footerColumns(sampleSeller));
  });

  it("setzt die Werte der Firma ein", () => {
    const { footer } = pdfData(own(["{firma}", "IBAN {iban}"]));
    expect(footer[0]).toEqual([sampleSeller.name]);
    expect(footer[1]![0]).toMatch(/^IBAN DE\d{2} /);
  });

  it("die Mahnung folgt derselben Fußzeile", () => {
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
      options: { ...DEFAULT_OPTIONS, footerColumns: ["Eigene Zeile", "{email}"] },
    };
    expect(dunningPdfData(doc).footer[0]).toEqual(["Eigene Zeile"]);
  });

  it("vier Spalten mit je fünf Zeilen bleiben auf einer Seite", () => {
    const voll = "{firma}\n{strasse}\n{plz} {ort}\n{email}\nSteuernummer {steuernummer}";
    const standard = pages(renderInvoicePdf(sampleDocument()));
    expect(standard).toBeGreaterThan(0);
    expect(pages(renderInvoicePdf(own([voll, voll, voll, voll])))).toBe(standard);
  });

  it("zwei Spalten und leere Spalten übersetzt die Vorlage", () => {
    expect(Buffer.from(renderInvoicePdf(own(["{firma}", ""])).subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
