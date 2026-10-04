import { describe, expect, it } from "vitest";
import { buildConfirmationPdf, buildDeliveryNotePdf, confirmationPdfData, deliveryNotePdfData } from "./order.ts";
import { mixedRateLines, sampleDocument } from "./samples.ts";

const sample = sampleDocument({ lines: mixedRateLines });
const quote = {
  number: "AN-2026-004",
  issueDate: "2026-09-20",
  validUntil: "2026-10-20",
  seller: sample.seller,
  buyer: sample.buyer,
  lines: sample.lines,
  totals: sample.totals,
};

describe("Auftragsbestätigung und Lieferschein", () => {
  it("Auftragsbestätigung: Bezug aufs Angebot, Auftragssumme, Dank statt Gültigkeit", () => {
    const data = confirmationPdfData(quote, "2026-09-25");
    expect(data.title).toBe("Auftragsbestätigung");
    expect(data.meta.slice(0, 2)).toEqual([
      { label: "Datum", value: "25.09.2026" },
      { label: "Zu Angebot", value: "AN-2026-004 (20.09.2026)" },
    ]);
    expect(data.meta.map((m) => m.label)).not.toContain("Gültig bis");
    expect(data.totals.gross.label).toBe("Auftragssumme");
    expect(data.payment).toMatch(/^Vielen Dank für Ihren Auftrag/);
    expect(confirmationPdfData({ ...quote, language: "en" }, "2026-09-25").title).toBe("Order confirmation");
    expect(Buffer.from(buildConfirmationPdf(quote, "2026-09-25").subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("Lieferschein: Mengen ohne Preise, Feld für die Unterschrift", () => {
    const doc = {
      reference: { kind: "rechnung" as const, number: "2026-034", issueDate: "2026-10-02" },
      deliveryDate: "2026-09-30",
      date: "2026-10-02",
      seller: sample.seller,
      buyer: sample.buyer,
      lines: sample.lines,
    };
    const data = deliveryNotePdfData(doc);
    expect(data.title).toBe("Lieferschein");
    expect(data.meta).toContainEqual({ label: "Zu Rechnung", value: "2026-034 (02.10.2026)" });
    expect(data.lines[0]).toMatchObject({ description: "Workshop „Buchhaltung für Freiberufler“", quantity: "2 Tag", unitPrice: "", net: "" });
    expect(data.totals).toBeNull();
    expect(JSON.stringify(data)).not.toContain("€");
    expect(Buffer.from(buildDeliveryNotePdf(doc).subarray(0, 5)).toString()).toBe("%PDF-");
  });
});
