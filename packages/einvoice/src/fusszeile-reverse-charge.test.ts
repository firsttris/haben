import { DEFAULT_OPTIONS } from "@haben/core";
import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";

/** TDD-Review #420: Die Pflichtangaben müssen auf dem Blatt stehen, nicht nur als Platzhalter in den Spalten */
const eigene = (footerColumns: string[]) => ({ ...sampleDocument(), options: { ...DEFAULT_OPTIONS, footerColumns } });
const ohneQr = (data: ReturnType<typeof pdfData>) => {
  const { qr: _qr, ...rest } = data;
  return JSON.stringify(rest);
};

describe("Eigene Fußzeile und USt-IdNr. bei Reverse Charge (§ 14a Abs. 1 UStG)", () => {
  it("nennt die USt-IdNr. des Leistenden auch dann, wenn die Vorlage nur {steuernummer} hat", () => {
    const doc = {
      ...eigene(["{firma}", "Steuernummer {steuernummer}"]),
      taxTreatment: "reverse_charge" as const,
      buyer: { ...sampleBuyer, land: "FR", ustId: "FR12345678901" },
    };
    expect(ohneQr(pdfData(doc))).toContain(sampleSeller.ustId!);
  });
});
