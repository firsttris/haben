import { DEFAULT_OPTIONS, footerIssues, LETTERHEAD_FONTS, type LetterheadFont, type LetterheadOptions } from "@haben/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { pdfData, renderInvoicePdf, templateInputs } from "./pdf.ts";
import { gmbhSeller, mixedRateLines, sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
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

/** Ausgabe eines Poppler-Werkzeugs für das PDF; null, wenn es fehlt (Tabelle der übersprungenen Tests in docs/entwicklung.md) */
function poppler(tool: string, args: string[], pdf: Uint8Array, after: string[] = []): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-gestaltung-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync(tool, [...args, join(dir, "beleg.pdf"), ...after], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasPoppler = poppler("pdffonts", [], renderInvoicePdf(sampleDocument())) !== null;

describe("Schrift der Belege", () => {
  it.each(Object.keys(LETTERHEAD_FONTS) as LetterheadFont[])("gibt der Vorlage die Familien von %s", (font) => {
    const inputs = templateInputs({}, { options: { ...DEFAULT_OPTIONS, font } }) as { font: unknown };
    const { regular, medium, semibold } = LETTERHEAD_FONTS[font];
    expect(inputs.font).toEqual({ regular, medium, semibold });
  });

  it.skipIf(!hasPoppler).each([
    ["plex-sans", "IBMPlexSans"],
    ["plex-serif", "IBMPlexSerif"],
    ["source-sans", "SourceSans3"],
    ["figtree", "Figtree"],
    ["fira-sans", "FiraSans"],
    ["inter", "Inter"],
    ["libre-franklin", "LibreFranklin"],
    ["literata", "Literata"],
    ["lora", "Lora"],
    ["nunito-sans", "NunitoSans"],
  ] as const)("bettet %s vollständig ein", (font, postscript) => {
    const fonts = poppler("pdffonts", [], renderInvoicePdf(withOptions({ font })))!;
    const lines = fonts.split("\n").slice(2).filter(Boolean);
    const mine = lines.filter((line) => line.includes(postscript));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    // Spalte „emb“ der Ausgabe: PDF/A verlangt eingebettete Schriften
    for (const line of mine) expect(line).toMatch(/\byes\b/);
    // Nur der Stempel „Entwurf“ dürfte die Plex Sans sonst brauchen, und den gibt es hier nicht
    if (font !== "plex-sans") expect(lines.some((line) => line.includes("IBMPlexSans"))).toBe(false);
  });
});

// 1×1 Pixel PNG, Hintergrund und Inhalt sind hier egal
const PIXEL = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
const langeZeilen = Array.from({ length: 34 }, (_, i) => ({
  description: `Position ${i + 1}`,
  quantity: 1000,
  unit: "Stk." as const,
  unitPrice: 1000,
  taxRate: 1900 as const,
}));

describe("Briefpapier", () => {
  const seitenMitBild = (backgroundPages: "erste" | "alle", mitBild = true) => {
    const doc = { ...withOptions({ backgroundPages }, { lines: langeZeilen }), ...(mitBild ? { background: { data: PIXEL, format: "png" as const } } : {}) };
    const list = poppler("pdfimages", ["-list"], renderInvoicePdf(doc))!;
    return (
      list
        .split("\n")
        .slice(2)
        .map((line) => line.trim().split(/\s+/))
        // Ohne die Alphamaske eines PNG, die pdfimages als eigene Zeile führt
        .filter((columns) => columns[2] === "image")
        .map((columns) => Number(columns[0]))
    );
  };

  it("nennt der Vorlage die Datei und die Seiten", () => {
    const inputs = templateInputs({}, { background: { data: PIXEL, format: "png" }, options: { ...DEFAULT_OPTIONS, backgroundPages: "alle" } }) as {
      background: string;
      look: { backgroundPages: string };
    };
    expect(inputs.background).toBe("briefpapier.png");
    expect(inputs.look.backgroundPages).toBe("alle");
  });

  it("nennt ohne Briefpapier keine Datei", () => {
    expect(templateInputs({}, {})).not.toHaveProperty("background");
  });

  it.skipIf(!hasPoppler)("liegt ab Werk nur auf der ersten Seite", () => {
    expect(seitenMitBild("erste")).toEqual([1]);
  });

  it.skipIf(!hasPoppler)("liegt auf Wunsch auf allen Seiten", () => {
    const seiten = seitenMitBild("alle");
    expect(seiten.length).toBeGreaterThan(1);
    expect(seiten).toEqual([...new Set(seiten)].sort((a, b) => a - b));
  });

  it.skipIf(!hasPoppler)("fehlt ohne Bild ganz", () => {
    expect(seitenMitBild("alle", false)).toEqual([]);
  });
});

describe("Fußzeile auf dem Briefpapier", () => {
  const bild = { background: { data: PIXEL, format: "png" as const } };
  const ohneFuss = (seller = sampleDocument().seller) => ({ ...sampleDocument(), seller, options: { ...DEFAULT_OPTIONS, footerHidden: true } });

  it("entfällt mit Briefpapier samt Pflichtzeile, die dann das Briefpapier trägt", () => {
    const data = pdfData({ ...ohneFuss(gmbhSeller), ...bild });
    expect(data.footer).toEqual([]);
    expect(data.legal).toBeNull();
  });

  it("bleibt ohne Briefpapier stehen, sonst fehlten die Pflichtangaben ganz", () => {
    const data = pdfData(ohneFuss());
    expect(data.footer.flat().join(" ")).toContain(sampleSeller.steuernummer!);
  });

  it("lässt sich als PDF erzeugen", () => {
    expect(renderInvoicePdf({ ...ohneFuss(), ...bild }).length).toBeGreaterThan(1000);
  });
});

describe("Kursiv in jeder Schrift", () => {
  it.skipIf(!hasPoppler).each([
    ["plex-serif", "IBMPlexSerif-Italic"],
    ["source-sans", "SourceSans3-It"],
    ["plex-sans", "IBMPlexSans-Italic"],
    ["figtree", "Figtree-Italic"],
    ["fira-sans", "FiraSans-Italic"],
    ["inter", "Inter-Italic"],
    ["libre-franklin", "LibreFranklin-Italic"],
    ["literata", "Literata-Italic"],
    ["lora", "Lora-Italic"],
    ["nunito-sans", "NunitoSans-Italic"],
  ] as const)("%s bettet echte Kursivschnitte ein", (font, postscript) => {
    const fonts = poppler("pdffonts", [], renderInvoicePdf({ ...withOptions({ font }), intro: "Text mit _kursiv_" }))!;
    expect(fonts).toContain(postscript);
  });
});

describe("Auszeichnungen in der eigenen Fußzeile", () => {
  const eigene = withOptions({ footerColumns: ["*Fettzeile*\n_Kursivzeile_\n__Unterzeile__", "{steuernummer}"] });

  it("gibt der Vorlage die Abschnitte, der Text bleibt ohne Zeichen", () => {
    const data = pdfData(eigene);
    expect(data.footer[0]).toEqual(["Fettzeile", "Kursivzeile", "Unterzeile"]);
    expect(data.footerFormatted?.[0]?.[0]?.[0]).toMatchObject({ text: "Fettzeile", bold: true });
  });

  it("die automatische Fußzeile bleibt ohne Abschnitte", () => {
    expect(pdfData(sampleDocument()).footerFormatted).toBeNull();
  });

  it.skipIf(!hasPoppler)("druckt fett und kursiv mit echten Schnitten und ohne die Zeichen", () => {
    const pdf = renderInvoicePdf(eigene);
    const text = poppler("pdftotext", ["-layout"], pdf, ["-"])!;
    expect(text).toContain("Fettzeile");
    expect(text).not.toContain("*Fettzeile*");
    const fonts = poppler("pdffonts", [], pdf)!;
    expect(fonts).toContain("IBMPlexSans-Italic");
  });
});

describe("Summenblock in breiten Schriften", () => {
  const steuerzeilen = (font: LetterheadFont, faktor = 1) => {
    const lines = mixedRateLines.map((line) => ({ ...line, unitPrice: line.unitPrice * faktor }));
    const text = poppler("pdftotext", ["-layout"], renderInvoicePdf({ ...sampleDocument({ lines }), options: { ...DEFAULT_OPTIONS, font } }), ["-"])!;
    return text.split("\n").filter((line) => line.includes("Umsatzsteuer 19 %"));
  };

  it.skipIf(!hasPoppler).each(Object.keys(LETTERHEAD_FONTS) as LetterheadFont[])("%s bricht die Steuerzeile nicht um, auch bei großen Beträgen", (font) => {
    for (const faktor of [1, 400]) expect(steuerzeilen(font, faktor).join()).toMatch(/Umsatzsteuer 19 % auf [\d.]+,\d\d/);
  });
});

describe("Zeichen der Fußzeile", () => {
  it("setzt jedes Zeichen, das footerIssues zulässt", () => {
    const erlaubt = Array.from({ length: 0xffff - 0x21 }, (_, i) => String.fromCodePoint(i + 0x21)).filter(
      (zeichen) => !/[\ud800-\udfff]/.test(zeichen) && footerIssues([`x${zeichen}`, "{steuernummer}"]).length === 0,
    );
    expect(erlaubt.length).toBeGreaterThan(500);
    expect(() => renderInvoicePdf({ ...sampleDocument(), note: erlaubt.join(" ") })).not.toThrow();
  });
});
