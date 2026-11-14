import { dunningAmounts } from "@haben/core";
import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { pdfData } from "./pdf.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { dunningSheetText, type SheetData, sheetText } from "./sheet-text.ts";

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

describe("Text des Blatts einer Mahnung", () => {
  const mahnung = dunningPdfData({
    level: 2,
    date: "2026-10-16",
    dueDate: "2026-10-26",
    seller: sampleSeller,
    buyer: sampleBuyer,
    invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
    amounts: dunningAmounts({ open: 1_740_958, dueDate: "2026-09-16", date: "2026-10-16", fee: 5_000, flatFee: false, interestRate: null }),
    intro: "leider haben wir *keinen* Zahlungseingang erhalten.",
    closing: "Sollten Sie bereits gezahlt haben, ist dieses Schreiben gegenstandslos.",
  });
  // Beträge stehen mit geschütztem Leerzeichen vor dem Euro
  const teil = (name: string) => (dunningSheetText(mahnung).find((part) => part.part === name)?.lines ?? []).map((line) => line.replace(/\s/g, " "));

  it("nennt Titel, Bezug, Einleitung ohne Auszeichnung und die gemahnte Rechnung", () => {
    const kopf = teil("kopf").join("\n");
    expect(kopf).toContain("Mahnung\nzur Rechnung");
    expect(kopf).toContain("zur Rechnung 2026-034 vom 02.09.2026");
    expect(kopf).toContain("leider haben wir keinen Zahlungseingang erhalten.");
    expect(teil("positionen")).toEqual(["2026-034 02.09.2026 16.09.2026 17.409,58 €"]);
  });

  it("führt Gebühr und den Betrag, der zu zahlen ist, auf, dann Zahlung und Schluss", () => {
    expect(teil("summen")).toEqual(["Offener Rechnungsbetrag: 17.409,58 €", "Mahngebühr: 50,00 €", "Zu zahlen: 17.459,58 €"]);
    expect(teil("hinweise").join("\n")).toContain("bis zum 26.10.2026");
    expect(teil("hinweise").join("\n")).toContain("gegenstandslos");
    expect(teil("fuss").length).toBeGreaterThan(0);
  });
});
