import { execFileSync } from "node:child_process";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { describe, expect, it } from "vitest";
import { pdfToPageImages } from "./pdf-pages.ts";

/** pdftoppm (poppler-utils) ist im Image installiert; auf Rechnern ohne läuft dieser Test nicht */
const hasPdftoppm = (() => {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function pdfWithPages(count: number): Uint8Array {
  const pages = Array.from({ length: count }, (_, i) => `Seite ${i + 1}`).join("\n#pagebreak()\n");
  return new Uint8Array(NodeCompiler.create().pdf({ mainFileContent: `#set page(width: 105mm, height: 148mm)\n${pages}` }));
}

describe.skipIf(!hasPdftoppm)("PDF in Seitenbilder (pdftoppm)", () => {
  it("wandelt jede Seite in ein PNG, in Seitenfolge", async () => {
    const { pages, truncated } = await pdfToPageImages(pdfWithPages(2), 4);
    expect(truncated).toBe(false);
    expect(pages).toHaveLength(2);
    for (const page of pages) expect([...page.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
  });

  it("höchstens maxPages Seiten und meldet den Rest", async () => {
    const { pages, truncated } = await pdfToPageImages(pdfWithPages(3), 2);
    expect(pages).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it("kaputtes PDF: verständlicher Fehler", async () => {
    await expect(pdfToPageImages(new TextEncoder().encode("%PDF-1.7 kaputt"), 2)).rejects.toThrow(/nicht in Bilder umwandeln/);
  });
});
