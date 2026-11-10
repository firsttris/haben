import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dunningAmounts, parseTextFormatting } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildDunningPdf, dunningPdfData } from "./dunning.ts";
import { sampleBuyer, sampleSeller } from "./samples.ts";

const doc = {
  level: 2 as const,
  date: "2026-10-16",
  dueDate: "2026-10-26",
  seller: sampleSeller,
  buyer: sampleBuyer,
  invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
  amounts: dunningAmounts({ open: 1_740_958, dueDate: "2026-09-16", date: "2026-10-16", fee: 5_000, flatFee: true, interestRate: 1_027 }),
  intro: "leider haben wir keinen Zahlungseingang erhalten.",
  closing: "Sollten Sie bereits gezahlt haben, ist dieses Schreiben gegenstandslos.",
};

const hasPoppler = spawnSync("pdftotext", ["-v"]).status === 0;

/** Schnitt eines Worts aus der Textebene, damit „fett“ nicht an einer anderen fetten Stelle hängt; kursiv meldet pdftohtml als <i> */
function styleOf(pdf: Uint8Array, word: string): { bold: boolean; italic: boolean } {
  const directory = mkdtempSync(join(tmpdir(), "haben-mahnung-"));
  try {
    const path = join(directory, "mahnung.pdf");
    writeFileSync(path, pdf);
    const layout = spawnSync("pdftohtml", ["-xml", "-stdout", "-i", path], { encoding: "utf8" });
    expect(layout.status, layout.stderr).toBe(0);
    const fonts = new Map([...layout.stdout.matchAll(/<fontspec\b[^>]*id="(\d+)"[^>]*family="([^"]*)"/g)].map((match) => [match[1], match[2]!]));
    const piece = [...layout.stdout.matchAll(/<text\b[^>]*font="(\d+)"[^>]*>(.*?)<\/text>/g)].find((match) => match[2]!.includes(word));
    expect(piece, `„${word}“ nicht im PDF`).toBeDefined();
    return { bold: fonts.get(piece![1])!.includes("SmBld"), italic: piece![2]!.includes("<i>") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Mahnung als PDF", () => {
  it("gibt Einleitung und Schluss mit denselben Auszeichnungen wie die Rechnung ins PDF", () => {
    const intro = "  *Zahlung* bitte _umgehend_  ";
    const closing = "__Danke__ für die *_rasche_* Erledigung";
    const data = dunningPdfData({ ...doc, intro, closing });
    expect(data.introFormatted).toEqual(parseTextFormatting(intro.trim()));
    expect(data.closingFormatted).toEqual(parseTextFormatting(closing.trim()));
  });

  it("lässt einen leeren Schluss leer", () => {
    expect(dunningPdfData({ ...doc, closing: "   " }).closingFormatted).toEqual([]);
  });

  it.skipIf(!hasPoppler)("druckt Auszeichnungen in Einleitung und Schluss ohne die Zeichen", () => {
    const pdf = buildDunningPdf({
      ...doc,
      intro: "*Einleitungsfett* und _Einleitungskursiv_ und __Einleitungslinie__",
      closing: "*Schlussfett* und _Schlusskursiv_ und *_Schlussbeides_*",
    });
    const result = spawnSync("pdftotext", ["-raw", "-", "-"], { input: pdf, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Einleitungsfett und Einleitungskursiv und Einleitungslinie");
    expect(result.stdout).toContain("Schlussfett und Schlusskursiv und Schlussbeides");
    expect(result.stdout).not.toMatch(/[*_]/);
    expect(styleOf(pdf, "Einleitungsfett")).toEqual({ bold: true, italic: false });
    expect(styleOf(pdf, "Einleitungskursiv")).toEqual({ bold: false, italic: true });
    expect(styleOf(pdf, "Schlussfett")).toEqual({ bold: true, italic: false });
    expect(styleOf(pdf, "Schlusskursiv")).toEqual({ bold: false, italic: true });
    expect(styleOf(pdf, "Schlussbeides")).toEqual({ bold: true, italic: true });
  });

  it("führt Gebühr, Pauschale und Zinsen auf", () => {
    const data = dunningPdfData(doc);
    expect(data.title).toBe("Mahnung");
    expect(data.rows.map((r) => r.label)).toEqual([
      "Offener Rechnungsbetrag",
      "Mahngebühr, soweit über der Pauschale",
      "Verzugspauschale (§ 288 Abs. 5 BGB)",
      "Verzugszinsen 10,27 % p. a. für 30 Tage",
    ]);
    expect(data.rows.map((r) => r.value).slice(1, 3)).toEqual(["10,00\u00a0€", "40,00\u00a0€"]);
    expect(data.payment).toContain("bis zum 26.10.2026");
    expect(data.payment).toContain("IBAN DE89 3704 0044 0532 0130 00");
    expect(data.qr).toMatch(/^<svg /);
  });

  it("bietet nach Fristablauf kein Skonto mehr an: voller Betrag und ein Hinweis, wenn die Rechnung Skonto hatte", () => {
    const withSkonto = dunningPdfData({ ...doc, invoice: { ...doc.invoice, skontoExpired: true } });
    expect(withSkonto.rows[0]).toEqual({ label: "Offener Rechnungsbetrag", value: "17.409,58 €" });
    expect(withSkonto.payment).toMatch(/ Das Skonto aus der Rechnung ist mit Ablauf der Skontofrist entfallen\.$/);
    expect(dunningPdfData(doc).payment).not.toContain("Skonto");
  });

  it("erzeugt ein PDF", () => {
    const pdf = buildDunningPdf(doc);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
