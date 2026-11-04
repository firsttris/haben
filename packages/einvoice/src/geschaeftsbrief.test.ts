import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dunningAmounts } from "@haben/core";
import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { deliveryNotePdfData } from "./order.ts";
import { footerData, legalLine, pdfData, renderInvoicePdf } from "./pdf.ts";
import { quotePdfData } from "./quote.ts";
import { TEXTS } from "./i18n.ts";
import { gmbhSeller, sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

/** Pflichtangaben einer GmbH nach § 35a Abs. 1 GmbHG im Fuß der Briefe und in der E-Rechnung */

const FUSS = "Sitz der Gesellschaft: Berlin · Registergericht: Amtsgericht Charlottenburg, HRB 123456 B · Geschäftsführung: Erika Mustermann, Max Mustermann";

/** Text eines PDFs mit pdftotext (poppler-utils); ohne das Werkzeug null */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-35a-"));
  try {
    const file = join(dir, "beleg.pdf");
    writeFileSync(file, pdf);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("legalLine", () => {
  it("setzt Sitz, Registergericht mit Nummer und alle Geschäftsführer in eine Zeile", () => {
    expect(legalLine(gmbhSeller.legalInfo)).toBe(FUSS);
  });

  it("nennt Rechtsform und Vorsitz des Aufsichtsrats, wenn nötig", () => {
    const info = { ...gmbhSeller.legalInfo!, legalForm: "GmbH", supervisoryBoardChair: "Hans Schulze" };
    expect(legalLine(info)).toBe(`Rechtsform: GmbH · ${FUSS} · Vorsitz des Aufsichtsrats: Hans Schulze`);
  });

  it("lässt Fehlendes weg; die Nummer steht ohne Gericht für sich", () => {
    expect(legalLine({ seat: "Berlin", registerCourt: "", registerNumber: "HRB 1 B", managingDirectors: [] })).toBe("Sitz der Gesellschaft: Berlin · HRB 1 B");
    expect(legalLine({ seat: "", registerCourt: "", registerNumber: "", managingDirectors: [] })).toBeNull();
  });

  it("beschriftet englische Belege auf Englisch", () => {
    expect(legalLine(gmbhSeller.legalInfo, TEXTS.en)).toBe(
      "Registered office: Berlin · Register court: Amtsgericht Charlottenburg, HRB 123456 B · Managing directors: Erika Mustermann, Max Mustermann",
    );
  });

  it("lässt den Fuß des Einzelunternehmens unverändert", () => {
    expect(legalLine(undefined)).toBeNull();
    expect(footerData(sampleSeller).legal).toBeNull();
    expect(pdfData(sampleDocument()).legal).toBeNull();
  });
});

describe("Pflichtangaben auf den Briefen", () => {
  it("stehen auf Rechnung, Angebot, Lieferschein und Mahnung", () => {
    const doc = { ...sampleDocument(), seller: gmbhSeller };
    expect(pdfData(doc).legal).toBe(FUSS);
    const { buyer, lines, totals } = doc;
    expect(quotePdfData({ number: "A-1", issueDate: "2026-10-01", validUntil: "2026-10-31", seller: gmbhSeller, buyer, lines, totals }).legal).toBe(FUSS);
    expect(
      deliveryNotePdfData({
        reference: { kind: "rechnung", number: doc.number, issueDate: doc.issueDate },
        deliveryDate: doc.issueDate,
        date: doc.issueDate,
        seller: gmbhSeller,
        buyer: sampleBuyer,
        language: "de",
        lines: [{ position: 1, description: "Server", quantity: 1000, unit: "Stk." }],
      }).legal,
    ).toBe(FUSS);
    const dunning = dunningPdfData({
      level: 1,
      date: "2026-10-16",
      dueDate: "2026-10-26",
      seller: gmbhSeller,
      buyer: sampleBuyer,
      invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
      amounts: dunningAmounts({ open: 10_000, dueDate: "2026-09-16", date: "2026-10-16", fee: 0, flatFee: false, interestRate: null }),
      intro: "",
      closing: "",
    });
    expect(dunning.legal).toBe(FUSS);
  });

  it("druckt sie in den Fuß des Rechnungs-PDFs", () => {
    const text = pdfText(renderInvoicePdf({ ...sampleDocument(), seller: gmbhSeller }));
    // Ohne pdftotext (poppler-utils) bleibt es bei der Prüfung der Daten oben
    if (text === null) return;
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("Registergericht: Amtsgericht Charlottenburg, HRB 123456 B");
    expect(flat).toContain("Geschäftsführung: Erika Mustermann, Max Mustermann");
    expect(pdfText(renderInvoicePdf(sampleDocument()))).not.toContain("Registergericht");
  });
});

/** Wörter eines PDFs mit unterem Rand und Seitenhöhe (pdftotext -bbox); ohne das Werkzeug null */
function pdfWords(pdf: Uint8Array): { text: string; yMax: number; pageHeight: number }[] | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-35a-"));
  try {
    const file = join(dir, "beleg.pdf");
    writeFileSync(file, pdf);
    const html = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
    return html.split("<page ").slice(1).flatMap((page) => {
      const pageHeight = Number(/height="([\d.]+)"/.exec(page)![1]);
      return [...page.matchAll(/yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ text: m[2]!, yMax: Number(m[1]), pageHeight }));
    });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Fuß mit langen Pflichtangaben", () => {
  // Rechtsform, drei Geschäftsführer und Aufsichtsrat: Die Zeile bricht um; der Fuß darf nicht über den Blattrand laufen
  const seller = {
    ...gmbhSeller,
    name: "Mustermann Software",
    legalInfo: {
      ...gmbhSeller.legalInfo!,
      legalForm: "UG (haftungsbeschränkt)",
      managingDirectors: ["Erika Annemarie Mustermann", "Maximilian Alexander Mustermann", "Friederike Charlotte Schulze-Westerhoff"],
      supervisoryBoardChair: "Hans-Joachim Lüdenscheid",
    },
  };
  const lines = Array.from({ length: 40 }, () => ({ description: "Softwareentwicklung", quantity: 1000, unit: "Std.", unitPrice: 9500, taxRate: 1900 }));

  it("bleibt mit Seitenzahl auf dem Blatt", () => {
    const words = pdfWords(renderInvoicePdf({ ...sampleDocument({ lines }), seller }));
    if (words === null) return;
    expect(words.some((w) => w.text === "Seite")).toBe(true);
    expect(words.some((w) => w.text === "Lüdenscheid")).toBe(true);
    expect(words.filter((w) => w.yMax > w.pageHeight).map((w) => w.text)).toEqual([]);
  });
});

describe("Pflichtangaben in der E-Rechnung", () => {
  it("UBL: Registernummer als BT-30, Pflichtangaben als BT-33", async () => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ format: "xrechnung-ubl" }), seller: gmbhSeller });
    expect(xml).toMatch(
      /<cac:PartyLegalEntity>\s*<cbc:RegistrationName>Mustermann Software GmbH<\/cbc:RegistrationName>\s*<cbc:CompanyID>HRB 123456 B<\/cbc:CompanyID>\s*<cbc:CompanyLegalForm>Sitz der Gesellschaft: Berlin/,
    );
  });

  it("CII und ZUGFeRD: SpecifiedLegalOrganization und Description des Verkäufers", async () => {
    for (const format of ["xrechnung-cii", "zugferd"] as const) {
      const { xml } = await buildEInvoice({ ...sampleDocument({ format }), seller: gmbhSeller });
      expect(xml).toContain(`<ram:Description>${FUSS}</ram:Description>`);
      expect(xml).toMatch(/<ram:SpecifiedLegalOrganization>\s*<ram:ID>HRB 123456 B<\/ram:ID>/);
    }
  });

  it("ohne GmbH weder BT-30 noch BT-33", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl" }));
    expect(xml).not.toContain("<cbc:CompanyID>HRB");
    expect(xml).not.toContain("CompanyLegalForm");
  });
});
