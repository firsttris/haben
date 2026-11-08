import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MAX_TEXT_CHARS, pdfPageTexts, textForModel } from "./pdf-seitentext.ts";
import { textPdf } from "./test-text-pdf.ts";

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const RECHNUNG = "Netzwerk Hosting GmbH\nRechnung RE-2026/0815 vom 15.09.2026\nWebhosting Business 12 Monate 154,32 EUR\nUmsatzsteuer 19 % 29,32 EUR";

describe("Text der Seiten für das Modell (#329)", () => {
  it("nimmt nur Seiten mit brauchbarem Text; ein Stempel oder Wasserzeichen reicht nicht", () => {
    const result = textForModel([RECHNUNG, "KOPIE", "   \n  ", "Seite 4: Allgemeine Geschäftsbedingungen der Netzwerk Hosting GmbH, Stand 2026"]);
    expect(result.missingPages).toEqual([2, 3]);
    expect(result.cut).toBe(false);
    expect(result.text).toContain("--- Seite 1 ---\nNetzwerk Hosting GmbH");
    expect(result.text).toContain("--- Seite 4 ---");
    expect(result.text).not.toContain("KOPIE");
  });

  it("ohne brauchbaren Text: kein Text", () => {
    expect(textForModel(["", "  "])).toEqual({ text: null, missingPages: [1, 2], cut: false });
  });

  it("kürzt sehr langen Text und sagt es", () => {
    const result = textForModel([`${RECHNUNG}\n${"Position 1 Hosting 10,00 EUR\n".repeat(5000)}`]);
    expect(result.cut).toBe(true);
    expect(result.text!.length).toBeLessThanOrEqual(MAX_TEXT_CHARS + 50);
  });

  it.skipIf(!hasPdftotext)("liest die Textschicht je Seite mit pdftotext, in der Reihenfolge der Seiten, und erkennt mehr Seiten als erlaubt", async () => {
    const pdf = textPdf([RECHNUNG, "", "Seite drei mit Zahlungsbedingungen: zahlbar binnen 14 Tagen ohne Abzug"]);
    const two = await pdfPageTexts(pdf, 2);
    expect(two?.truncated).toBe(true);
    expect(two?.pages).toHaveLength(2);
    expect(two?.pages[0]).toContain("Rechnung RE-2026/0815");
    expect(two?.pages[1]?.trim()).toBe("");
    const all = await pdfPageTexts(pdf, 5);
    expect(all?.truncated).toBe(false);
    expect(all?.pages[2]).toContain("Zahlungsbedingungen");
  });

  it("ohne Textschicht oder bei kaputter Datei: null statt Fehler", async () => {
    expect(await pdfPageTexts(new TextEncoder().encode("%PDF-1.4 kaputt"), 2)).toBeNull();
  });
});
