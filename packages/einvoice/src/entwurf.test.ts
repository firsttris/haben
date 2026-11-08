import { describe, expect, it } from "vitest";
import { buildDunningDraftPdf, buildDunningPdf, type DunningDocument } from "./dunning.ts";
import { TEXTS } from "./i18n.ts";
import { asDraft, draftFilename, pdfData, renderInvoiceDraftPdf, renderInvoicePdf } from "./pdf.ts";
import { buildQuoteDraftPdf } from "./quote.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { draftLayers } from "./test-pdf.ts";

/** Entwürfe als PDF (Issue #342): Vermerk über jeder Seite, „ENTWURF“ statt Nummer, kein bezahlbarer GiroCode */

// 34 Positionen: drei Seiten, damit der Vermerk auch auf Folgeseiten geprüft wird
const longLines = Array.from({ length: 34 }, (_, i) => ({
  description: `Softwareentwicklung Modul ${i + 1}, Konzeption und Umsetzung`,
  quantity: 8000,
  unit: "Std." as const,
  unitPrice: 9500,
  taxRate: 1900 as const,
}));

function draftOf(options: Parameters<typeof sampleDocument>[0] = {}) {
  const { number: _number, ...doc } = sampleDocument(options);
  return doc;
}

const dunning: DunningDocument = {
  level: 1,
  date: "2026-10-20",
  dueDate: "2026-11-03",
  seller: sampleSeller,
  buyer: sampleBuyer,
  invoice: { number: "2026-034", issueDate: "2026-10-02", dueDate: "2026-10-16" },
  amounts: { open: 30_000, fee: 0, flatFee: 0, interest: 0, interestRate: 0, interestDays: 0, total: 30_000 },
  intro: "sicher haben Sie die Rechnung übersehen.",
  closing: "",
};

describe("asDraft", () => {
  it("setzt den Vermerk und ersetzt den GiroCode durch den Platzhalter", () => {
    const data = asDraft({ qr: "<svg/>", title: "Rechnung" }, TEXTS.de);
    expect(data).toMatchObject({ draft: "ENTWURF", qr: null, qrPlaceholder: "erscheint im endgültigen PDF", title: "Rechnung" });
  });

  it("ohne GiroCode auch kein Platzhalter", () => {
    expect(asDraft({ qr: null }, TEXTS.de).qrPlaceholder).toBeNull();
    expect(asDraft({}, TEXTS.de).qrPlaceholder).toBeNull();
  });

  it("auf Englisch DRAFT", () => {
    expect(asDraft({ qr: "<svg/>" }, TEXTS.en)).toMatchObject({ draft: "DRAFT", qrPlaceholder: "appears in the final PDF" });
  });
});

describe("draftFilename", () => {
  it("nennt Belegart, Entwurf und Datum, ohne Leerzeichen", () => {
    expect(draftFilename("Rechnung", "2026-10-02", TEXTS.de)).toBe("Rechnung-Entwurf-2026-10-02.pdf");
    expect(draftFilename("Partial invoice", "2026-10-02", TEXTS.en)).toBe("Partial-invoice-Draft-2026-10-02.pdf");
  });
});

describe("renderInvoiceDraftPdf", () => {
  it("trägt den Vermerk auf jeder Seite, über dem Inhalt", async () => {
    const { pdf } = renderInvoiceDraftPdf(draftOf({ lines: longLines }));
    const layers = await draftLayers(pdf);
    expect(layers.length).toBeGreaterThan(1);
    expect(layers.every((l) => l.marked && l.overContent)).toBe(true);
  });

  it("das endgültige PDF hat keinen Vermerk", async () => {
    const layers = await draftLayers(renderInvoicePdf(sampleDocument({ lines: longLines })));
    expect(layers.some((l) => l.marked)).toBe(false);
  });

  it("ist ein PDF/A-3b mit Dateinamen nach Belegart und Sprache", () => {
    const de = renderInvoiceDraftPdf(draftOf());
    expect(Buffer.from(de.pdf).toString("latin1")).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(de.filename).toBe("Rechnung-Entwurf-2026-10-02.pdf");
    expect(renderInvoiceDraftPdf({ ...draftOf(), language: "en" }).filename).toBe("Invoice-Draft-2026-10-02.pdf");
    expect(renderInvoiceDraftPdf({ ...draftOf(), variant: "abschlag" }).filename).toBe("Abschlagsrechnung-Entwurf-2026-10-02.pdf");
    expect(renderInvoiceDraftPdf(draftOf({ kind: "korrektur" })).filename).toBe("Rechnungskorrektur-Entwurf-2026-10-02.pdf");
  });

  it("zeigt ENTWURF statt einer Nummer, auch im GiroCode-Text nichts Bezahlbares", () => {
    const data = asDraft(pdfData({ ...draftOf(), number: TEXTS.de.draft.mark }), TEXTS.de);
    expect(data.meta[0]).toEqual({ label: "Rechnungsnummer", value: "ENTWURF" });
    expect(data.docTitle).toBe("Rechnung ENTWURF");
    expect(data.qr).toBeNull();
    expect(data.qrPlaceholder).toBe("erscheint im endgültigen PDF");
  });
});

describe("buildQuoteDraftPdf", () => {
  it("Angebot mit Vermerk auf jeder Seite", async () => {
    const draft = buildQuoteDraftPdf({ ...draftOf({ lines: longLines }), validUntil: "2026-11-01" });
    expect(draft.filename).toBe("Angebot-Entwurf-2026-10-02.pdf");
    const layers = await draftLayers(draft.pdf);
    expect(layers.length).toBeGreaterThan(1);
    expect(layers.every((l) => l.marked && l.overContent)).toBe(true);
  });
});

describe("buildDunningDraftPdf", () => {
  it("Mahnung mit Vermerk, die festgehaltene ohne", async () => {
    const draft = buildDunningDraftPdf(dunning);
    expect(draft.filename).toBe("Zahlungserinnerung-Entwurf-2026-10-20.pdf");
    expect((await draftLayers(draft.pdf)).every((l) => l.marked && l.overContent)).toBe(true);
    expect((await draftLayers(buildDunningPdf(dunning))).some((l) => l.marked)).toBe(false);
  });
});
