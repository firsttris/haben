import { DEFAULT_OPTIONS } from "@haben/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";

/** TDD-Review #420: Ein hoher Fuß darf die Seitenzahl nicht an die Blattkante schieben */
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

const A4_HOEHE_PT = 841.89;
const mmVomBlattrand = (wort: Wort) => (A4_HOEHE_PT - wort.yMax) / (72 / 25.4);
const hatPdftotext = worteJeSeite(renderInvoicePdf(sampleDocument())) !== null;

const positionen = Array.from({ length: 34 }, (_, i) => ({
  description: `Position ${i + 1}`,
  quantity: 1000,
  unit: "Stk." as const,
  unitPrice: 1000,
  taxRate: 1900 as const,
}));
const zweiSeiten = sampleDocument({ lines: positionen });
const zeile = "Zahlbar innerhalb von vierzehn Tagen ohne Abzug";
const hoheSpalte = Array.from({ length: 5 }, () => zeile).join("\n");
const seitenzahl = (seiten: Wort[][]) => seiten[0]!.find((wort) => wort.text === "Seite")!;

describe.skipIf(!hatPdftotext)("Eigene Fußzeile: Abstand zur Blattkante", () => {
  it("hält die Seitenzahl bei einem hohen Fuß so weit von der Blattkante wie bei der automatischen Fußzeile", () => {
    const automatisch = seitenzahl(worteJeSeite(renderInvoicePdf(zweiSeiten))!);
    const hoch = seitenzahl(
      worteJeSeite(
        renderInvoicePdf({ ...zweiSeiten, options: { ...DEFAULT_OPTIONS, footerColumns: [hoheSpalte, hoheSpalte, hoheSpalte, "{steuernummer}"] } }),
      )!,
    );
    expect(mmVomBlattrand(hoch)).toBeGreaterThanOrEqual(mmVomBlattrand(automatisch));
  });
});
