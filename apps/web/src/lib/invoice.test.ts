import { describe, expect, it } from "vitest";
import { customerDraft, invoiceTitle } from "./invoice.ts";

describe("invoiceTitle", () => {
  it("nennt Abschlags- und Schlussrechnung nur bei Rechnungen", () => {
    expect(invoiceTitle("rechnung", null)).toBe("Rechnung");
    expect(invoiceTitle("rechnung", "abschlag")).toBe("Abschlagsrechnung");
    expect(invoiceTitle("storno", "schluss")).toBe("Stornorechnung");
    expect(invoiceTitle("angebot")).toBe("Angebot");
  });
});

describe("customerDraft (#1557)", () => {
  const draft = {
    contactId: null as string | null,
    format: "zugferd" as const,
    language: "de",
    paymentTermDays: 14,
    skonto: [] as { days: number; percentBp: number }[],
  };
  const kunde = { id: "k1", isCustomer: true, defaultFormat: null, leitwegId: null, language: "en", skonto: null };
  const firmenSkonto = [
    { days: 7, percentBp: 200 },
    { days: 30, percentBp: 100 },
  ];

  it("übernimmt Sprache, Format und Skonto des Kunden wie beim Wählen im Editor", () => {
    // Skonto aus den Firmendaten ohne eigenes; Fristen über das Zahlungsziel hinaus entfallen
    expect(customerDraft(draft, [kunde], "k1", firmenSkonto)).toMatchObject({
      contactId: "k1",
      language: "en",
      format: "zugferd",
      skonto: [{ days: 7, percentBp: 200 }],
    });
    // Mit Leitweg-ID XRechnung, ein eigenes Format geht vor
    expect(customerDraft(draft, [{ ...kunde, leitwegId: "991-12345-67" }], "k1", firmenSkonto)?.format).toBe("xrechnung-cii");
    expect(customerDraft(draft, [{ ...kunde, leitwegId: "991-12345-67", defaultFormat: "xrechnung-ubl" as const }], "k1", firmenSkonto)?.format).toBe(
      "xrechnung-ubl",
    );
    expect(customerDraft(draft, [{ ...kunde, skonto: [{ days: 10, percentBp: 300 }] }], "k1", firmenSkonto)?.skonto).toEqual([{ days: 10, percentBp: 300 }]);
  });

  it("ein reiner Lieferant oder ein unbekannter Kontakt wird nicht vorausgewählt", () => {
    expect(customerDraft(draft, [{ ...kunde, isCustomer: false }], "k1", firmenSkonto)).toBeNull();
    expect(customerDraft(draft, [kunde], "k2", firmenSkonto)).toBeNull();
    expect(customerDraft(draft, [kunde], undefined, firmenSkonto)).toBeNull();
  });
});
