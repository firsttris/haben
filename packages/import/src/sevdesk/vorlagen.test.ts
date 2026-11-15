import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SevDocumentPos, SevInvoice } from "./types.ts";
import { mapSevRecurringInvoice, sevBilling, sevIntervalMonths, sevPlaceholders, sevPlainText } from "./vorlagen.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test-fixtures/sevdesk/buchhaltung-1.0/${name}`, import.meta.url), "utf8"));
const templates = fixture("rechnungsvorlage-wkr.json") as {
  invoice: SevInvoice;
  positions: SevDocumentPos[];
}[];
const generated = fixture("rechnungen-aus-vorlage.json") as SevInvoice[];
const byId = (id: string) => templates.find((t) => String(t.invoice.id) === id)!;

describe("sevDesk-Vorlagen wiederkehrender Rechnungen", () => {
  it("liest die Intervalle von sevDesk in Monaten, Wochen und Tage gehen nicht", () => {
    expect(sevIntervalMonths("P0Y1M")).toBe(1);
    expect(sevIntervalMonths("P0Y3M")).toBe(3);
    expect(sevIntervalMonths("P1Y")).toBe(12);
    expect(sevIntervalMonths("P1Y0M")).toBe(12);
    expect(sevIntervalMonths("P0Y0M1W")).toBeNull();
    expect(sevIntervalMonths("P0Y0M0W14D")).toBeNull();
    expect(sevIntervalMonths("P")).toBeNull();
    expect(sevIntervalMonths(null)).toBeNull();
  });

  it("leitet nachfällig und vorschüssig aus den erzeugten Rechnungen ab", () => {
    // ID_26: zwei Rechnungen am Monatsende für den Monat; ID_20: eine am Monatsanfang
    expect(sevBilling("ID_26", generated)).toEqual({
      billing: "nachfaellig",
      evidence: 2,
    });
    expect(sevBilling("ID_20", generated)).toEqual({
      billing: "vorschuessig",
      evidence: 1,
    });
    expect(sevBilling("ID_15", generated)).toEqual({
      billing: "unklar",
      evidence: 0,
    });
  });

  it("bleibt unklar, wenn sich die erzeugten Rechnungen widersprechen", () => {
    const mixed = [generated[0]!, { ...generated[2]!, origin: { id: "ID_26", objectName: "Invoice" } }];
    expect(sevBilling("ID_26", mixed).billing).toBe("unklar");
  });

  it("listet die Platzhalter je einmal und lässt sie im Text stehen", () => {
    expect(sevPlaceholders(["Rechnung [%Rechnungsnummer%]", "Zahlbar [%ZAHLUNGSZIEL%] [%KONTAKTPERSON%]", "[%ZAHLUNGSZIEL%]", null])).toEqual([
      "[%Rechnungsnummer%]",
      "[%ZAHLUNGSZIEL%]",
      "[%KONTAKTPERSON%]",
    ]);
    expect(sevPlainText("<p>Hallo [%KONTAKTPERSON%],</p><p>danke &amp; Gruß<br/>Team</p>")).toBe("Hallo [%KONTAKTPERSON%],\ndanke & Gruß\nTeam");
    expect(sevPlainText("<anon>")).toBe("<anon>");
  });

  it("bildet die nachfällige Monatsvorlage mit Termin am Monatsende ab", () => {
    const t = byId("ID_26");
    const raw = {
      ...t.invoice,
      accountNextInvoice: "2026-11-30T12:00:00+01:00",
    };
    const mapped = mapSevRecurringInvoice(raw, t.positions, generated);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.billing).toBe("nachfaellig");
    expect(mapped.billingEvidence).toBe(2);
    expect(mapped.template).toMatchObject({
      intervalMonths: 1,
      nextDate: "2026-11-30",
      anchorDay: 31,
      servicePeriod: "laufend",
      endDate: null,
      priceMode: "netto",
      taxTreatment: "regulaer",
      paymentTermDays: 1,
      note: "<anon> [%ZAHLUNGSZIEL%] [%KONTAKTPERSON%]",
    });
    expect(mapped.template.lines).toEqual([
      {
        description: "<anon>",
        detail: "",
        itemNumber: "",
        quantity: 1000,
        unit: "Stk.",
        unitPrice: 10000,
        taxRate: 1900,
      },
      {
        description: "<anon>",
        detail: "<anon>",
        itemNumber: "",
        quantity: 1000,
        unit: "Stk.",
        unitPrice: 10000,
        taxRate: 1900,
      },
    ]);
    expect(mapped.placeholders).toEqual(["[%ZAHLUNGSZIEL%]", "[%KONTAKTPERSON%]"]);
    expect(mapped.contactSevdeskId).toBe(String(t.invoice.contact!.id));
    expect(mapped.sevStatus).toBe("100");
  });

  it("bildet die vorschüssige Vorlage mit laufendem Zeitraum ab", () => {
    const t = byId("ID_20");
    const mapped = mapSevRecurringInvoice(t.invoice, t.positions, generated);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.billing).toBe("vorschuessig");
    expect(mapped.template).toMatchObject({
      servicePeriod: "laufend",
      anchorDay: 15,
      nextDate: "2024-01-15",
    });
  });

  it("lässt den Leistungszeitraum ohne erzeugte Rechnung offen und sagt es", () => {
    const t = byId("ID_26");
    const mapped = mapSevRecurringInvoice(t.invoice, t.positions, []);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.billing).toBe("unklar");
    expect(mapped.template.servicePeriod).toBe("keiner");
    expect(mapped.hints.join(" ")).toContain("In sevDesk nachsehen");
  });

  it("nimmt bei Bruttopreisen den Bruttopreis und bei leerer Bezeichnung einen Ersatz", () => {
    const t = byId("ID_15");
    const mapped = mapSevRecurringInvoice({ ...t.invoice, accountIntervall: "P0Y3M" }, t.positions, generated);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.template.priceMode).toBe("brutto");
    expect(mapped.template.intervalMonths).toBe(3);
    expect(mapped.template.lines[0]).toMatchObject({
      description: "Position",
      unitPrice: 0,
      taxRate: 1900,
    });
    expect(mapped.hints.join(" ")).toContain("keine Bezeichnung");
    expect(mapped.sevStatus).toBe("50");
  });

  it("übernimmt das Enddatum einer beendeten Vorlage", () => {
    const t = byId("ID_20");
    const mapped = mapSevRecurringInvoice(
      {
        ...t.invoice,
        status: "1000",
        accountEndDate: "2025-06-30T00:00:00+02:00",
      },
      t.positions,
      generated,
    );
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.template.endDate).toBe("2025-06-30");
    expect(mapped.sevStatus).toBe("1000");
  });

  it("lehnt ab, was Haben nicht abbilden kann", () => {
    const t = byId("ID_15");
    const weekly = mapSevRecurringInvoice(t.invoice, t.positions, generated);
    expect(weekly).toMatchObject({
      ok: false,
      reason: expect.stringContaining("P0Y0M1W"),
    });
    const monthly = { ...t.invoice, accountIntervall: "P0Y1M" };
    expect(mapSevRecurringInvoice({ ...monthly, currency: "USD" }, t.positions, [])).toMatchObject({ ok: false });
    expect(mapSevRecurringInvoice(monthly, [{ ...t.positions[0]!, taxRate: "16" }], [])).toMatchObject({ ok: false });
    expect(mapSevRecurringInvoice(monthly, [{ ...t.positions[0]!, discount: "10" }], [])).toMatchObject({ ok: false });
    expect(mapSevRecurringInvoice(monthly, [], [])).toMatchObject({
      ok: false,
    });
    expect(mapSevRecurringInvoice({ ...monthly, taxType: "custom" }, t.positions, [])).toMatchObject({ ok: false });
  });

  it("übernimmt die Steuerart Kleinunternehmer mit Hinweis", () => {
    const t = byId("ID_20");
    const mapped = mapSevRecurringInvoice(
      { ...t.invoice, smallSettlement: "1" },
      t.positions.map((p) => ({ ...p, taxRate: "0" })),
      [],
    );
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.template.taxTreatment).toBe("kleinunternehmer");
    expect(mapped.hints.join(" ")).toContain("Kleinunternehmer");
  });
});
