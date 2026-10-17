import { describe, expect, it, vi } from "vitest";
import { decimalToCents, describeExtractionError, toFields, type Extraction } from "./extraction.ts";

const base: Extraction = {
  lieferant: " Hetzner Online GmbH ",
  lieferantUstId: "de 812871812",
  rechnungsnummer: "R0018834512",
  belegdatum: "2026-09-30",
  faelligAm: null,
  waehrung: "eur",
  istGutschrift: false,
  betraege: [{ steuersatz: "19", netto: "32.40", steuer: "6.16" }],
  brutto: "38.56",
  kategorie: "edv",
  hinweis: null,
};

describe("KI-Auslesung umwandeln", () => {
  it("Dezimaltext exakt in Cent", () => {
    expect(decimalToCents("1234.5")).toBe(123450);
    expect(decimalToCents("0,99")).toBe(99);
    expect(decimalToCents("-3")).toBe(-300);
    expect(decimalToCents("12.345")).toBeNull();
    expect(decimalToCents("abc")).toBeNull();
    // Mehr als 3 Mio. € passt nicht sicher in die Spalten
    expect(decimalToCents("3000000")).toBe(300_000_000);
    expect(decimalToCents("3000000.01")).toBeNull();
  });

  it("verwirft unmögliche Daten und kürzt lange Texte", () => {
    const fields = toFields({ ...base, belegdatum: "2025-13-45", faelligAm: "2026-02-30", lieferant: "x".repeat(500), rechnungsnummer: "1".repeat(300) });
    expect(fields).toMatchObject({ documentDate: null, dueDate: null });
    expect(fields.supplierName).toHaveLength(200);
    expect(fields.invoiceNumber).toHaveLength(100);
  });

  it("gibt Datenbankfehler nicht roh an den Beleg weiter", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeExtractionError(new Error('Failed query: update "documents" set ...'))).toMatch(/^Die Auslesung ist fehlgeschlagen/);
  });

  it("übernimmt Felder und prüft die Summe", () => {
    const fields = toFields(base);
    expect(fields).toMatchObject({
      supplierName: "Hetzner Online GmbH",
      supplierUstId: "DE812871812",
      invoiceNumber: "R0018834512",
      documentDate: "2026-09-30",
      currency: "EUR",
      category: "edv",
      amounts: [{ taxRate: 1900, net: 3240, tax: 616 }],
      warnings: [],
    });
  });

  it("warnt bei abweichender Summe, fremder Währung und ungültigem Datum", () => {
    const fields = toFields({ ...base, brutto: "40.00", waehrung: "USD", belegdatum: "30.09.2026", hinweis: "Beleg unscharf" });
    expect(fields.documentDate).toBeNull();
    expect(fields.warnings).toEqual([
      "Summe aus Netto und Steuer weicht vom Gesamtbetrag ab",
      "Währung USD: bitte in Euro umrechnen",
      "Beleg unscharf",
    ]);
  });

  it("Gutschrift wird negativ", () => {
    expect(toFields({ ...base, istGutschrift: true, brutto: "38.56" }).amounts).toEqual([{ taxRate: 1900, net: -3240, tax: -616 }]);
  });
});
