import { describe, expect, it, vi } from "vitest";
import { decimalToCents, describeExtractionError, extractDocument, toFields, type Extraction } from "./extraction.ts";
import { ExtractionError } from "./extraction-schema.ts";

const base: Extraction = {
  lieferant: " Hetzner Online GmbH ",
  lieferantUstId: "de 812871812",
  empfaenger: null,
  empfaengerUstId: null,
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

  it("übernimmt den Reverse-Charge-Hinweis als Vorschlag für § 13b", () => {
    const felder = toFields({
      ...base,
      // Gebührenrechnung aus Irland; mit deutscher USt-IdNr. gäbe es keinen Vorschlag (Test unten)
      lieferant: "Etsy Ireland UC",
      lieferantUstId: "IE9777587C",
      betraege: [{ steuersatz: "0", netto: "115.44", steuer: "0.00" }],
      brutto: "115.44",
      kategorie: "fremdleistung",
      reverseCharge: "eu",
    });
    expect(felder.reverseCharge).toBe("eu");
    expect(felder.category).toBe("fremdleistung");
    // Ohne Hinweis auf dem Beleg bleibt die Behandlung offen
    expect(toFields(base).reverseCharge).toBeNull();
  });

  it("lässt die Beträge bei § 13b wie auf dem Beleg; Satz und Steuer setzt erst der Beleg (documents.test.ts)", () => {
    const felder = toFields({
      ...base,
      // Gebührenrechnung aus Irland; mit deutscher USt-IdNr. gäbe es keinen Vorschlag (Test unten)
      lieferant: "Etsy Ireland UC",
      lieferantUstId: "IE9777587C",
      betraege: [{ steuersatz: "0", netto: "115.44", steuer: "0.00" }],
      brutto: "115.44",
      kategorie: "fremdleistung",
      reverseCharge: "eu",
    });
    expect(felder.amounts).toEqual([{ taxRate: 0, net: 11544, tax: 0 }]);
    // Der Rechnungsbetrag ist das Netto, die Steuer steht nicht auf dem Beleg
    expect(felder.warnings).not.toContain("Summe aus Netto und Steuer weicht vom Gesamtbetrag ab");
  });

  it("schlägt § 13b nicht vor, wenn der Beleg Umsatzsteuer ausweist", () => {
    // Bei § 13b steht keine Steuer auf der Rechnung (§ 14a Abs. 5 UStG); weist sie 19 % aus, ist es kein Reverse Charge
    const felder = toFields({ ...base, lieferant: "Etsy Ireland UC", lieferantUstId: "IE9777587C", reverseCharge: "eu" });
    expect(felder.reverseCharge).toBeNull();
  });

  it("schlägt § 13b nicht vor, wenn der Rechnungssteller eine deutsche USt-IdNr. hat", () => {
    // Haben kennt § 13b nur für Leistungen aus dem EU-Ausland (Abs. 1, Kz 46/47) und dem Drittland (Abs. 2 Nr. 1);
    // ein Hinweis auf einer Rechnung aus Deutschland (etwa Bauleistung, Abs. 2 Nr. 4) gehört in keins von beiden
    const felder = toFields({
      ...base,
      betraege: [{ steuersatz: "0", netto: "1000.00", steuer: "0.00" }],
      brutto: "1000.00",
      reverseCharge: "eu",
    });
    expect(felder.reverseCharge).toBeNull();
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
      "Währung USD: bitte den Umrechnungskurs eintragen",
      "Beleg unscharf",
    ]);
  });

  it("Gutschrift wird negativ", () => {
    expect(toFields({ ...base, istGutschrift: true, brutto: "38.56" }).amounts).toEqual([{ taxRate: 1900, net: -3240, tax: -616 }]);
  });
});

describe("Anbieter der Auslesung", () => {
  const local = {
    provider: "openai-compatible" as const,
    model: "qwen2.5vl:7b",
    endpoint: "http://127.0.0.1:9/v1/chat/completions",
    apiKey: null,
    timeoutMs: 1_000,
    maxPages: 4,
    input: "bild" as const,
    extraBody: {},
  };
  const pdfWarning = "Das PDF hat mehr als 4 Seiten; ausgelesen wurden nur die ersten 4.";
  const providers = () => ({
    anthropic: vi.fn(async () => ({ extraction: base, warnings: [] as string[] })),
    "openai-compatible": vi.fn(async () => ({ extraction: base, warnings: [pdfWarning] })),
  });

  it("ruft nur den gewählten Anbieter und prüft dessen Antwort wie bisher", async () => {
    const calls = providers();
    const result = await extractDocument(new Uint8Array([1]), "pdf", local, calls);
    expect(calls["openai-compatible"]).toHaveBeenCalledOnce();
    expect(calls.anthropic).not.toHaveBeenCalled();
    expect(result.fields).toMatchObject({ supplierName: "Hetzner Online GmbH", amounts: [{ taxRate: 1900, net: 3240, tax: 616 }] });
    expect(result.fields.warnings).toEqual([pdfWarning]);
  });

  it("kein Cloud-Fallback: schlägt der eigene Dienst fehl, bleibt Anthropic unberührt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = providers();
    calls["openai-compatible"].mockRejectedValueOnce(
      new ExtractionError("Der KI-Dienst unter http://127.0.0.1:9/v1 ist nicht erreichbar.", "nicht-erreichbar"),
    );
    await expect(extractDocument(new Uint8Array([1]), "jpeg", local, calls)).rejects.toThrow(/nicht erreichbar/);
    expect(calls.anthropic).not.toHaveBeenCalled();
    // Im Log Anbieter, Modell und Fehlerart, aber nicht die Meldung mit Adresse oder Inhalten
    expect(warn).toHaveBeenCalledWith("KI-Auslesung fehlgeschlagen (openai-compatible, qwen2.5vl:7b): nicht-erreichbar");
  });

  it("ohne Einrichtung kein Aufruf", async () => {
    const calls = providers();
    await expect(extractDocument(new Uint8Array([1]), "jpeg", null, calls)).rejects.toThrow(/nicht eingerichtet/);
    expect(calls.anthropic).not.toHaveBeenCalled();
    expect(calls["openai-compatible"]).not.toHaveBeenCalled();
  });

  it("Fehler des eigenen Dienstes stehen unverändert am Beleg", () => {
    const message = "Die Antwort des KI-Dienstes passt nicht zum Belegschema.";
    expect(describeExtractionError(new ExtractionError(message, "schema"))).toBe(message);
  });
});
