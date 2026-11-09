import { DEFAULT_OPTIONS } from "@haben/core";
import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleDocument, sampleSeller } from "./samples.ts";

/** TDD-Review #420: Die Pflichtangaben müssen auf dem Blatt stehen, nicht nur als Platzhalter in den Spalten */
const eigene = (footerColumns: string[]) => ({ ...sampleDocument(), options: { ...DEFAULT_OPTIONS, footerColumns } });
const ohneQr = (data: ReturnType<typeof pdfData>) => {
  const { qr: _qr, ...rest } = data;
  return JSON.stringify(rest);
};

describe("Eigene Fußzeile und Steuernummer (§ 14 Abs. 4 Nr. 2 UStG)", () => {
  it("nennt die USt-IdNr., wenn die Vorlage nur {steuernummer} hat und die Firma nur eine USt-IdNr. führt", () => {
    const doc = { ...eigene(["{firma}", "Steuernummer {steuernummer}"]), seller: { ...sampleSeller, steuernummer: "" } };
    expect(ohneQr(pdfData(doc))).toContain(sampleSeller.ustId!);
  });
});
