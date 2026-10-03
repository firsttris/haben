import { describe, expect, it } from "vitest";
import { buildQuotePdf, quotePdfData, type QuoteDocument } from "./quote.ts";
import { sampleDocument } from "./samples.ts";

function sampleQuote(overrides: Partial<QuoteDocument> = {}): QuoteDocument {
  const { seller, buyer, lines, totals } = sampleDocument();
  return { number: "AN-2026-007", issueDate: "2026-10-01", validUntil: "2026-10-31", seller, buyer, lines, totals, ...overrides };
}

describe("Angebot", () => {
  it("hat Titel, Gültigkeit und keine Zahlungsaufforderung", () => {
    const data = quotePdfData(sampleQuote({ serviceFrom: "2026-11-01", serviceTo: "2026-11-30" }));
    expect(data.title).toBe("Angebot");
    expect(data.meta).toEqual([
      { label: "Angebotsnummer", value: "AN-2026-007" },
      { label: "Angebotsdatum", value: "01.10.2026" },
      { label: "Gültig bis", value: "31.10.2026" },
      { label: "Leistungszeitraum", value: "01.11.2026 – 30.11.2026" },
      { label: "Kundennummer", value: "K-1007" },
    ]);
    expect(data.totals.gross.label).toBe("Angebotssumme");
    expect(data.payment).toBe("Dieses Angebot gilt bis zum 31.10.2026. Wir freuen uns auf Ihren Auftrag.");
    expect(data.taxNote).toBeNull();
  });

  it("zeigt bei Kleinunternehmern den Hinweis statt der Steuer", () => {
    const data = quotePdfData(sampleQuote({ taxTreatment: "kleinunternehmer" }));
    expect(data.totals.rows).toHaveLength(1);
    expect(data.taxNote).toMatch(/§ 19 UStG/);
  });

  it("erzeugt ein PDF", () => {
    const pdf = buildQuotePdf(sampleQuote());
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
