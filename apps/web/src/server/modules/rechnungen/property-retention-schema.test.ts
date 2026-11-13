import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Auswahl des Aufbewahrungshinweises für Grundstücksleistungen", () => {
  let invoices: typeof import("./invoices.ts");
  let recurring: typeof import("./recurring.ts");

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/haben",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "x".repeat(32),
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "https://haben.example.de",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32).toString("base64"),
    });
    invoices = await import("./invoices.ts");
    recurring = await import("./recurring.ts");
  });

  afterAll(async () => {
    await (await import("../../db/index.ts")).closeDatabase();
  });

  const draft = {
    contactId: null,
    issueDate: "2026-11-02",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd",
    note: "Freier Fußtext bleibt erhalten.",
    lines: [{ description: "Montage", quantity: 1000, unit: "Std.", unitPrice: 10000, taxRate: 1900 }],
  };

  it("übernimmt die ausdrückliche Auswahl und lässt bestehende Entwürfe ohne Auswahl ausgeschaltet", () => {
    expect(invoices.draftSchema.parse({ ...draft, propertyRetention: true })).toMatchObject({ propertyRetention: true, note: draft.note });
    expect(invoices.draftSchema.parse(draft)).toMatchObject({ propertyRetention: false });
    expect(invoices.draftSchema.safeParse({ ...draft, propertyRetention: "true" }).success).toBe(false);
  });

  it("übernimmt die Auswahl auch in wiederkehrenden Vorlagen und verlangt einen Wahrheitswert", () => {
    const template = {
      ...draft,
      contactId: "00000000-0000-4000-8000-000000000001",
      name: "Monatliche Gartenpflege",
      active: true,
      taxTreatment: "regulaer",
      exemptionReason: "",
      intervalMonths: 1,
      nextDate: "2026-11-02",
      endDate: null,
      servicePeriod: "laufend",
      mode: "entwurf",
    };
    expect(recurring.recurringInputSchema.parse({ ...template, propertyRetention: true })).toMatchObject({ propertyRetention: true });
    expect(recurring.recurringInputSchema.parse(template)).toMatchObject({ propertyRetention: false });
    expect(recurring.recurringInputSchema.safeParse({ ...template, propertyRetention: "true" }).success).toBe(false);
  });
});
