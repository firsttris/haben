import { describe, expect, it } from "vitest";
import type { FbRecurring } from "./types.ts";
import { mapFbRecurring } from "./vorlagen.ts";

// Vorlage in der Form von recurring.get am echten Konto (Feldformen), Namen und Beträge erfunden
const vorlage = (fields: Partial<FbRecurring> = {}): FbRecurring => ({
  INVOICE_ID: "5001",
  CUSTOMER_ID: "601",
  INVOICE_TITLE: "Wartung Website",
  INTROTEXT: "Für die Betreuung im kommenden Jahr berechnen wir:",
  NOTE: "",
  CURRENCY_CODE: "EUR",
  FREQUENCY: "yearly",
  START_DATE: "2027-03-01",
  OCCURENCES: "0",
  IS_GROSS: "0",
  VAT_CASE: "0",
  PAYMENT_TYPE: "1",
  CASH_DISCOUNT_PERCENT: "0",
  CASH_DISCOUNT_DAYS: "0",
  DISCOUNT_PERCENT: "",
  DISCOUNT_AMOUNT: "",
  SERVICE_PERIOD_START: "0000-00-00 00:00:00",
  DELIVERY_DATE: "",
  ITEMS: [
    {
      ARTICLE_NUMBER: "W-1",
      DESCRIPTION: "Wartungspauschale\nUpdates und Sicherungen",
      QUANTITY: 12,
      UNIT: "Monat",
      UNIT_PRICE: "120.00",
      VAT_PERCENT: "19.00",
      COMPLETE_NET: "1440.00",
      COMPLETE_GROSS: "1713.60",
      DISCOUNT_PERCENT: "",
      DISCOUNT_AMOUNT: "",
    },
  ],
  ...fields,
});

describe("mapFbRecurring", () => {
  it("übernimmt eine jährliche Vorlage mit Kunde, Positionen, Einheit und Art.-Nr., netto bei IS_GROSS 0", () => {
    const mapped = mapFbRecurring(vorlage());
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.customerId).toBe("601");
    expect(mapped.template).toMatchObject({
      name: "Wartung Website",
      intro: "Für die Betreuung im kommenden Jahr berechnen wir:",
      intervalMonths: 12,
      nextDate: "2027-03-01",
      anchorDay: 1,
      endDate: null,
      priceMode: "netto",
      taxTreatment: "regulaer",
      servicePeriod: "keiner",
      lines: [
        {
          description: "Wartungspauschale",
          detail: "Updates und Sicherungen",
          itemNumber: "W-1",
          quantity: 12_000,
          unit: "Monat",
          unitPrice: 12_000,
          taxRate: 1900,
        },
      ],
    });
    expect(mapped.hints.join(" ")).toContain("Startdatum aus FastBill");
  });

  it.each([
    ["monthly", 1],
    ["3 months", 3],
    ["6 months", 6],
    ["yearly", 12],
  ])("ordnet den Turnus %s %i Monaten zu", (frequency, months) => {
    const mapped = mapFbRecurring(vorlage({ FREQUENCY: frequency }));
    expect(mapped.ok && mapped.template.intervalMonths).toBe(months);
  });

  it.each(["weekly", "2 weeks", "4 weeks", "2 months"])("übernimmt den Turnus %s nicht und nennt den Grund", (frequency) => {
    const mapped = mapFbRecurring(vorlage({ FREQUENCY: frequency }));
    expect(mapped).toEqual({ ok: false, reason: expect.stringContaining(`Turnus „${frequency}“`) });
  });

  it("rechnet aus OCCURENCES das Enddatum, mit 0 ohne Ende, am Monatsende auf den letzten Tag", () => {
    const begrenzt = mapFbRecurring(vorlage({ FREQUENCY: "monthly", START_DATE: "2027-01-31", OCCURENCES: "3" }));
    expect(begrenzt.ok && [begrenzt.template.endDate, begrenzt.template.anchorDay]).toEqual(["2027-03-31", 31]);
    const offen = mapFbRecurring(vorlage({ OCCURENCES: "0" }));
    expect(offen.ok && offen.template.endDate).toBeNull();
  });

  it("nimmt bei IS_GROSS 1 die Preise als brutto", () => {
    const mapped = mapFbRecurring(vorlage({ IS_GROSS: "1", ITEMS: [{ ...vorlage().ITEMS![0]!, UNIT_PRICE: "142.80" }] }));
    expect(mapped.ok && [mapped.template.priceMode, mapped.template.lines[0]!.unitPrice]).toEqual(["brutto", 14_280]);
  });

  it("lehnt Fremdwährung, Rabatt, unbekannten Steuersatz, VAT_CASE 1 und Vorlagen ohne Positionen mit Grund ab", () => {
    const item = vorlage().ITEMS![0]!;
    const reasons = [
      vorlage({ CURRENCY_CODE: "USD" }),
      vorlage({ DISCOUNT_PERCENT: "10" }),
      vorlage({ ITEMS: [{ ...item, DISCOUNT_AMOUNT: "5.00" }] }),
      vorlage({ ITEMS: [{ ...item, VAT_PERCENT: "16" }] }),
      vorlage({ VAT_CASE: "1" }),
      vorlage({ ITEMS: [] }),
    ].map((v) => {
      const m = mapFbRecurring(v);
      return m.ok ? "übernommen" : m.reason;
    });
    expect(reasons).toEqual([
      expect.stringContaining("Währung USD"),
      expect.stringContaining("Rabatt auf die Rechnung"),
      expect.stringContaining("Position 1: Rabatt"),
      expect.stringContaining("Steuersatz 16 %"),
      expect.stringContaining("Umsatzsteuerfall „1“"),
      "Die Vorlage hat keine Positionen.",
    ]);
  });

  it("nennt Zahlungsart, Skonto, Leistungszeitraum und unbekannte Einheit als Hinweis, statt die Vorlage abzulehnen", () => {
    const mapped = mapFbRecurring(
      vorlage({
        PAYMENT_TYPE: "4",
        CASH_DISCOUNT_PERCENT: "2",
        CASH_DISCOUNT_DAYS: "10",
        SERVICE_PERIOD_START: "2027-03-01 00:00:00",
        ITEMS: [{ ...vorlage().ITEMS![0]!, UNIT: "Lizenz" }],
      }),
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.template.lines[0]!.unit).toBe("Stk.");
    expect(mapped.hints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Einheit „Lizenz“"),
        expect.stringContaining("Skonto 2 % in 10 Tagen"),
        expect.stringContaining("PayPal"),
        expect.stringContaining("Leistungszeitraum"),
      ]),
    );
  });
});
