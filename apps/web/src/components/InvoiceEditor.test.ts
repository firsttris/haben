import { describe, expect, it, vi } from "vitest";

// Nur previewNumber und das Schema der Vorschau: Die Server-Funktionen und die Datenbank des Editors bleiben draußen
vi.mock("../server/functions/invoices.ts", () => ({
  finalizeInvoiceDraft: () => undefined,
  removeInvoiceDraft: () => undefined,
  saveInvoiceDraft: () => undefined,
  renderDocumentPreview: () => undefined,
}));
vi.mock("../server/functions/quotes.ts", () => ({
  finalizeQuoteDraft: () => undefined,
  removeQuoteDraft: () => undefined,
  saveQuoteDraft: () => undefined,
}));
vi.mock("../server/functions/articles.ts", () => ({ saveArticle: () => undefined }));
vi.mock("../server/functions/logo.ts", () => ({ saveLetterheadDesign: () => undefined }));
vi.mock("../server/db/index.ts", () => {
  // Steht an Stelle jeder Tabelle oder Abfrage, die Module beim Laden anfassen
  const ersatz: unknown = new Proxy(() => {}, { get: () => ersatz, apply: () => ersatz });
  return { db: ersatz, schema: ersatz };
});

import { previewNumber } from "./InvoiceEditor.tsx";
import { documentPreviewSchema } from "../server/modules/rechnungen/document-preview.ts";

describe("previewNumber mit {KUNDENNR} (#1426)", () => {
  it("lässt {KUNDENNR} stehen, wenn die Kundennummer nicht in die Nummer darf", () => {
    const number = previewNumber("RE-{KUNDENNR}-{NNN}", "2026-03-02", 1, { kundennummer: "K 1" }, null);
    expect(documentPreviewSchema.shape.number.safeParse(number).success).toBe(true);
    expect(number).toBe("RE-{KUNDENNR}-001");
  });

  it("lässt {KUNDENNR} stehen, wenn dem Kunden die Kundennummer fehlt", () => {
    const number = previewNumber("RE-{KUNDENNR}-{NNN}", "2026-03-02", 1, null, null);
    expect(number).toContain("{KUNDENNR}");
    expect(number).not.toContain("braucht");
  });

  it("setzt eine verwendbare Kundennummer ein", () => {
    expect(previewNumber("RE-{KUNDENNR}-{NNN}", "2026-03-02", 1, { kundennummer: "10001" }, null)).toBe("RE-10001-001");
  });
});
