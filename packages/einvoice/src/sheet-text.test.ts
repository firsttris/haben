import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { type SheetData, sheetText } from "./sheet-text.ts";

const data = () => pdfData({ ...sampleDocument({}), intro: "Vielen *Dank* für Ihren Auftrag", note: "Bitte _pünktlich_ zahlen" }) as unknown as SheetData;
const lines = (name: string, d = data()) => sheetText(d).find((part) => part.part === name)?.lines ?? [];

describe("Text des gesetzten Blatts", () => {
  it("nennt Absender, Empfänger, Titel und Kopfangaben", () => {
    const kopf = lines("kopf").join("\n");
    const d = data();
    expect(kopf).toContain(d.senderLine);
    expect(kopf).toContain(d.recipient[0]);
    expect(kopf).toContain(d.title);
    expect(kopf).toContain(`${d.meta[0]!.label}: ${d.meta[0]!.value}`);
  });

  it("gibt Auszeichnungen ohne ihre Zeichen wieder", () => {
    expect(lines("kopf").join("\n")).toContain("Vielen Dank für Ihren Auftrag");
    expect(lines("hinweise").join("\n")).toContain("Bitte pünktlich zahlen");
  });

  it("listet jede Position mit Beträgen und die Summen", () => {
    const d = data();
    expect(lines("positionen")[0]).toContain(d.lines[0]!.description);
    expect(lines("positionen")[0]).toContain(d.lines[0]!.net);
    expect(lines("summen").join("\n")).toContain(d.totals!.gross.value);
  });

  it("führt die Fußzeile und die Pflichtangaben auf", () => {
    const d = { ...data(), legal: "Sitz: Berlin" };
    expect(lines("fuss", d)).toContain("Sitz: Berlin");
    expect(lines("fuss", d)).toContain(d.footer[0]![0]);
  });

  it("lässt leere Teile weg", () => {
    const d = { ...data(), totals: null, lines: [] };
    expect(sheetText(d).map((part) => part.part)).not.toContain("summen");
    expect(sheetText(d).map((part) => part.part)).not.toContain("positionen");
  });
});
