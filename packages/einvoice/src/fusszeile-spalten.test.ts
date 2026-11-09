import { DEFAULT_OPTIONS } from "@haben/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";

/** TDD-Review #420: Ein langes Wort darf nicht in die Nachbarspalte des Fußes laufen */
type Wort = { xMin: number; xMax: number; yMin: number; yMax: number; text: string };

function worteJeSeite(pdf: Uint8Array): Wort[][] | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-blattrand-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    const xml = execFileSync("pdftotext", ["-bbox", join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
    return xml
      .split("<page ")
      .slice(1)
      .map((seite) =>
        [...seite.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({
          xMin: Number(m[1]),
          yMin: Number(m[2]),
          xMax: Number(m[3]),
          yMax: Number(m[4]),
          text: m[5]!,
        })),
      );
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hatPdftotext = worteJeSeite(renderInvoicePdf(sampleDocument())) !== null;

describe.skipIf(!hatPdftotext)("Eigene Fußzeile: Spalten überlappen sich nicht", () => {
  it("bricht eine lange E-Mail-Adresse in vier Spalten um, statt in die Nachbarspalte zu laufen", () => {
    const seller = { ...sampleDocument().seller, email: "buchhaltung@mustermannconsulting.de" };
    const seiten = worteJeSeite(
      renderInvoicePdf({ ...sampleDocument(), seller, options: { ...DEFAULT_OPTIONS, footerColumns: ["{email}", "Sprechzeiten", "Termine", "{steuernummer}"] } }),
    )!;
    const worte = seiten[0]!;
    const nachbar = worte.find((wort) => wort.text === "Sprechzeiten")!;
    const inZeile = worte.filter((wort) => Math.abs(wort.yMin - nachbar.yMin) < 1 && wort.xMin < nachbar.xMin);
    expect(Math.max(...inZeile.map((wort) => wort.xMax))).toBeLessThanOrEqual(nachbar.xMin);
  });
});
