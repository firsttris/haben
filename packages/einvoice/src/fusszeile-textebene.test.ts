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

  it("lässt ein langes Wort in der Zeile mit den Pflichtangaben unverändert, sie steht über die ganze Breite", () => {
    const name = "Erika Leutheusser-Schnarrenberger-Mustermann";
    const seller = { ...gmbhSeller, legalInfo: { ...gmbhSeller.legalInfo!, managingDirectors: [name] } };
    const text = textebene(
      renderInvoicePdf({ ...sampleDocument(), seller, options: { ...DEFAULT_OPTIONS, footerColumns: ["{firma}", "{iban}", "{email}", "{steuernummer}"] } }),
    )!;
    expect(text).toContain(name);
  });
});
