import { describe, expect, it } from "vitest";
import { dunningPdfData } from "./dunning.ts";
import { confirmationPdfData, deliveryNotePdfData } from "./order.ts";
import { pdfData, recipientLines } from "./pdf.ts";
import { quotePdfData } from "./quote.ts";
import { mixedRateLines, sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import type { Buyer } from "./types.ts";

/*
 * Ansprechpartner (#424): Die Zeile „z. Hd. <Name>“ steht im Empfängerblock hinter dem Firmennamen, vor der Anschrift,
 * in allen Belegarten und in beiden Sprachen. Sie kommt als Zeile im Feld `recipient` an, das jede eingebaute und jede
 * eigene Vorlage setzt; der Feldvertrag der Vorlagen ändert sich nicht. Ohne Ansprechpartner bleibt der Block wie bisher.
 * Funktion, E-Mail und Telefon der Person stehen nicht im PDF. Alle Namen sind erfunden.
 */

const mit: Buyer = {
  ...sampleBuyer,
  ansprechpartner: { name: "Mara Beispiel", email: "mara@nordwerk.example", telefon: "+49 40 7654321", funktion: "Einkauf" },
};

describe("Ansprechpartner im Empfängerblock", () => {
  it("steht hinter dem Firmennamen und vor der Anschrift, deutsch und englisch", () => {
    expect(recipientLines(mit)).toEqual([mit.name, "z. Hd. Mara Beispiel", mit.strasse, `${mit.plz} ${mit.ort}`]);
  });

  it("ohne Ansprechpartner wie bisher", () => {
    expect(recipientLines(sampleBuyer)).toEqual([sampleBuyer.name, sampleBuyer.strasse, `${sampleBuyer.plz} ${sampleBuyer.ort}`]);
  });

  it("zeigt Funktion, E-Mail und Telefon nicht", () => {
    expect(recipientLines(mit).join("\n")).not.toMatch(/Einkauf|mara@|7654321/);
  });
});

describe("Ansprechpartner in allen Belegarten", () => {
  const sample = sampleDocument({ lines: mixedRateLines, buyer: mit });
  const quote = {
    number: "AN-2026-004",
    issueDate: "2026-09-20",
    validUntil: "2026-10-20",
    seller: sample.seller,
    buyer: mit,
    lines: sample.lines,
    totals: sample.totals,
  };
  const zeile = (data: { recipient: string[] }) => data.recipient.slice(0, 2);

  it("Rechnung, Angebot, Auftragsbestätigung, Lieferschein und Mahnung", () => {
    const erwartet = [mit.name, "z. Hd. Mara Beispiel"];
    expect(zeile(pdfData(sample))).toEqual(erwartet);
    expect(zeile(quotePdfData(quote))).toEqual(erwartet);
    expect(zeile(confirmationPdfData(quote, "2026-09-25"))).toEqual(erwartet);
    const lieferschein = {
      reference: { kind: "rechnung" as const, number: "2026-034", issueDate: "2026-10-02" },
      deliveryDate: "2026-09-30",
      date: "2026-10-02",
      seller: sample.seller,
      buyer: mit,
      lines: sample.lines,
    };
    expect(zeile(deliveryNotePdfData(lieferschein))).toEqual(erwartet);
    const mahnung = {
      level: 1 as const,
      date: "2026-10-16",
      dueDate: "2026-10-26",
      seller: sampleSeller,
      buyer: mit,
      invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
      amounts: { open: 10_000, fee: 0, interest: 0, total: 10_000 } as never,
      intro: "leider fehlt Ihre Zahlung.",
      closing: "Danke.",
    };
    expect(zeile(dunningPdfData(mahnung))).toEqual(erwartet);
  });

  it("englische Belege nennen die Zeile englisch", () => {
    const en = pdfData({ ...sampleDocument({ buyer: mit }), language: "en" });
    expect(en.recipient[1]).toBe("FAO Mara Beispiel");
    const ohne = pdfData({ ...sampleDocument({ buyer: sampleBuyer }), language: "en" });
    expect(ohne.recipient).toEqual([sampleBuyer.name, sampleBuyer.strasse, `${sampleBuyer.plz} ${sampleBuyer.ort}`]);
  });
});
