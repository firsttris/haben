import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Vorschau aus dem Formular (Postgres)", () => {
  let preview: typeof import("./document-preview.ts");
  let sql: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    sql = await setupTestDb();
    preview = await import("./document-preview.ts");
  });

  afterAll(async () => {
    await sql?.end();
  });

  const input = (overrides: Partial<import("./document-preview.ts").DocumentPreviewInput> = {}) =>
    preview.documentPreviewSchema.parse({
      kind: "rechnung",
      number: "2026-001",
      issueDate: "2026-11-02",
      dueDate: "2026-11-16",
      validUntil: null,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      contactId: null,
      buyerOrderReference: "",
      sellerOrderReference: "",
      despatchAdviceReference: "",
      lines: [{ description: "Beratung", itemNumber: "B-1", quantity: 2000, unit: "Std.", unitPrice: 10000, taxRate: 1900 }],
      discount: null,
      plan: [],
      intro: "Vielen *Dank*",
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      priceMode: "netto",
      language: "de",
      variant: null,
      corrects: null,
      currency: "EUR",
      skonto: [],
      sepaMandateId: null,
      design: {},
      ...overrides,
    });

  const text = (parts: { lines: string[] }[]) => parts.flatMap((part) => part.lines).join("\n");

  it("setzt ein ungespeichertes Formular als Blatt, ohne Kunden mit Hinweis", async () => {
    const result = await preview.documentPreview(input());
    expect(result.svg.startsWith("<svg")).toBe(true);
    expect(result.pages).toBe(1);
    expect(text(result.text)).toContain("[Kunde wählen]");
    expect(text(result.text)).toContain("Vielen Dank");
    expect(text(result.text)).toContain("B-1 Beratung");
  });

  it("rechnet Summen wie beim Speichern", async () => {
    expect(text((await preview.documentPreview(input())).text)).toContain("238,00");
  });

  it("zeigt ungespeicherte Gestaltung, ohne etwas zu speichern", async () => {
    const standard = await preview.documentPreview(input());
    const farbig = await preview.documentPreview(input({ design: { accent: "#9B1C1C" } }));
    expect(farbig.svg).not.toBe(standard.svg);
    const danach = await preview.documentPreview(input());
    expect(danach.svg).toBe(standard.svg);
  });

  it("setzt Angebote mit optionalen Positionen und Zahlungsplan", async () => {
    const result = await preview.documentPreview(
      input({
        kind: "angebot",
        validUntil: "2026-12-02",
        lines: [
          { description: "Hauptleistung", quantity: 1000, unit: "Psch.", unitPrice: 100000, taxRate: 1900 },
          { description: "Extra", quantity: 1000, unit: "Psch.", unitPrice: 5000, taxRate: 1900, kind: "optional" },
        ],
        plan: [{ label: "Anzahlung", due: "Bei Auftrag", share: { kind: "rest" } }],
      }),
    );
    expect(text(result.text)).toContain("Extra");
    expect(text(result.text)).toContain("Anzahlung");
    expect(text(result.text)).toContain("1.190,00");
  });

  it("zeigt Abzüge und Stornos mit negativen Beträgen", async () => {
    const result = await preview.documentPreview(input({ kind: "storno", corrects: { number: "2026-000", issueDate: "2026-10-01" }, lines: [{ description: "Storno", quantity: 1000, unit: "Psch.", unitPrice: -5000, taxRate: 1900 }] }));
    expect(text(result.text)).toContain("2026-000");
  });

  it("nimmt unfertige Datumsfelder an", async () => {
    await expect(preview.documentPreview(input({ dueDate: "" }))).resolves.toMatchObject({ pages: 1 });
  });
});
