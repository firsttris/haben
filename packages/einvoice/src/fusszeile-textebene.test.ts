import { DEFAULT_OPTIONS } from "@haben/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./pdf.ts";
import { gmbhSeller, sampleDocument } from "./samples.ts";

function textebene(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-textebene-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", [join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function wortbreite(pdf: Uint8Array, wort: string): number {
  const dir = mkdtempSync(join(tmpdir(), "haben-textebene-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    const xml = execFileSync("pdftotext", ["-bbox", join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
    const treffer = [...xml.matchAll(/xMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*>([^<]*)</g)].find((m) => m[3] === wort);
    return Number(treffer![2]) - Number(treffer![1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hatPdftotext = textebene(renderInvoicePdf(sampleDocument())) !== null;

/** TDD-Review #420: Die weichen Umbrüche aus softBreaks stehen als U+200B in der Textebene, auch wenn gar nichts umbricht */
describe.skipIf(!hatPdftotext)("Eigene Fußzeile: Textebene", () => {
  it("lässt eine E-Mail-Adresse, die in die Spalte passt, beim Kopieren und Suchen unverändert", () => {
    const email = "buchhaltung@mustermannconsulting.de";
    const text = textebene(
      renderInvoicePdf({
        ...sampleDocument(),
        seller: { ...sampleDocument().seller, email },
        options: { ...DEFAULT_OPTIONS, footerColumns: ["{email}", "{steuernummer}"] },
      }),
    )!;
    expect(text).toContain(email);
  });

  it("lässt ein kurzes Wort neben einem zu langen in der eigenen Spalte unverändert", () => {
    const seller = { ...sampleDocument().seller, email: "buchhaltung@mustermannconsulting.de" };
    const text = textebene(
      renderInvoicePdf({
        ...sampleDocument(),
        seller,
        options: { ...DEFAULT_OPTIONS, footerColumns: ["Rechnungsfragen: {email}", "Sprechzeiten", "Termine", "{steuernummer}"] },
      }),
    )!;
    expect(text).toContain("Rechnungsfragen:");
  });

  it("lässt eine E-Mail-Adresse unverändert, die in Normalschrift gerade in eine von vier Spalten passt", () => {
    const email = "buchhaltung@mustermannco.de";
    const seller = { ...sampleDocument().seller, email };
    const breit = renderInvoicePdf({ ...sampleDocument(), seller, options: { ...DEFAULT_OPTIONS, footerColumns: ["{email}", "{steuernummer}"] } });
    const spalte = ((165 - 3 * 6) / 4) * (72 / 25.4);
    expect(wortbreite(breit, email)).toBeLessThanOrEqual(spalte);
    const text = textebene(
      renderInvoicePdf({
        ...sampleDocument(),
        seller,
        options: { ...DEFAULT_OPTIONS, footerColumns: ["{email}", "Sprechzeiten", "Termine", "{steuernummer}"] },
      }),
    )!;
    expect(text).toContain(email);
  });

  it("lässt ein langes Wort in der Zeile mit den Pflichtangaben unverändert, sie steht über die ganze Breite", () => {
    const name = "Erika Leutheusser-Schnarrenberger-Mustermann";
    const seller = { ...gmbhSeller, legalInfo: { ...gmbhSeller.legalInfo!, managingDirectors: [name] } };
    const text = textebene(
      renderInvoicePdf({ ...sampleDocument(), seller, options: { ...DEFAULT_OPTIONS, footerColumns: ["{firma}", "{iban}", "{email}", "{steuernummer}"] } }),
    )!;
    // Die Zeile darf am Bindestrich umbrechen; pdftotext zieht ihn dort weg, darum je Namensteil
    for (const teil of name.split("-")) expect(text).toContain(teil);
  });
});
