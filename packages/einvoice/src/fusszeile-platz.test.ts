import { DEFAULT_OPTIONS, footerIssues, MAX_FOOTER_LINES, MAX_FOOTER_TEXT } from "@haben/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./pdf.ts";
import { gmbhSeller, sampleDocument } from "./samples.ts";

/** TDD-Review #420: Was die Prüfung der Spalten durchlässt, muss auch auf das Blatt passen */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-fuss-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", ["-layout", join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasPdftotext = pdfText(renderInvoicePdf(sampleDocument())) !== null;

// Eine ganz normale Zeile: in vier Spalten (rund 37 mm je Spalte) bricht sie einmal um
const zeile = "Zahlbar innerhalb von vierzehn Tagen ohne Abzug";
const spalte = (marke: string) => [...Array.from({ length: MAX_FOOTER_LINES - 1 }, () => zeile), `${zeile} ${marke}`].join("\n");
const spalten = [spalte("ENDEA"), spalte("ENDEB"), spalte("ENDEC"), "{steuernummer}"];

const eigene = (seller = sampleDocument().seller) => ({
  ...sampleDocument(),
  seller,
  options: { ...DEFAULT_OPTIONS, footerColumns: spalten },
});

describe.skipIf(!hasPdftotext)("Eigene Fußzeile: was gespeichert werden darf, steht auf dem Blatt", () => {
  it("die Spalten sind zulässig", () => {
    expect(footerIssues(spalten)).toEqual([]);
    for (const text of spalten) expect(text.length).toBeLessThanOrEqual(MAX_FOOTER_TEXT);
  });

  it("zeigt fünf umbrechende Zeilen in vier Spalten vollständig", () => {
    const text = pdfText(renderInvoicePdf(eigene()))!;
    expect(["ENDEA", "ENDEB", "ENDEC"].filter((marke) => !text.includes(marke))).toEqual([]);
  });

  it("verliert dabei die Pflichtangaben der GmbH nicht (§ 35a Abs. 1 GmbHG)", () => {
    const text = pdfText(renderInvoicePdf(eigene(gmbhSeller)))!;
    expect(text.includes("HRB 123456 B")).toBe(true);
  });
});
