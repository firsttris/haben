import { dueDates } from "@haben/core";
import { describe, expect, it } from "vitest";
import type { FbRecurring } from "./types.ts";
import { mapFbRecurring } from "./vorlagen.ts";

// Antworten des Maintainers in #1523 auf die offenen Fragen der Selbstprüfung; Daten erfunden
const vorlage = (fields: Partial<FbRecurring> = {}): FbRecurring => ({
  INVOICE_ID: "5001",
  CUSTOMER_ID: "601",
  INVOICE_TITLE: "Wartung Website",
  CURRENCY_CODE: "EUR",
  FREQUENCY: "yearly",
  START_DATE: "2027-03-01",
  OCCURENCES: "0",
  IS_GROSS: "0",
  VAT_CASE: "0",
  PAYMENT_TYPE: "1",
  DISCOUNT_PERCENT: "",
  DISCOUNT_AMOUNT: "",
  ITEMS: [{ DESCRIPTION: "Wartung", QUANTITY: 1, UNIT: "Monat", UNIT_PRICE: "120.00", VAT_PERCENT: "19.00" }],
  ...fields,
});

const TODAY = "2026-11-19";

describe("mapFbRecurring: Termine", () => {
  it("rückt ein Startdatum in der Vergangenheit auf den ersten Termin ab heute, damit beim Aktivieren nichts nachträglich entsteht", () => {
    const mapped = mapFbRecurring(vorlage({ START_DATE: "2024-03-01", FREQUENCY: "yearly" }), [], TODAY);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.template.nextDate).toBe("2027-03-01");
    expect(dueDates(mapped.template.nextDate, mapped.template.intervalMonths, mapped.template.anchorDay, TODAY, mapped.template.endDate)).toEqual([]);
    expect(mapped.hints.join(" ")).toContain("2024-03-01");
  });

  it("lässt ein Startdatum ab heute stehen", () => {
    const mapped = mapFbRecurring(vorlage({ START_DATE: "2026-11-19", FREQUENCY: "monthly" }), [], TODAY);
    expect(mapped.ok && mapped.template.nextDate).toBe("2026-11-19");
  });

  it("behält einen Start am 28. bis 30. als festen Tag, nur der 31. ist das Monatsende", () => {
    const am30 = mapFbRecurring(vorlage({ START_DATE: "2027-04-30", FREQUENCY: "monthly" }), [], TODAY);
    const am31 = mapFbRecurring(vorlage({ START_DATE: "2027-01-31", FREQUENCY: "monthly" }), [], TODAY);
    expect(am30.ok && am30.template.anchorDay).toBe(30);
    expect(am31.ok && am31.template.anchorDay).toBe(31);
  });

  it("nennt die Zahl der Läufe aus FastBill als Hinweis zum Prüfen", () => {
    const mapped = mapFbRecurring(vorlage({ OCCURENCES: "3" }), [], TODAY);
    expect(mapped.ok && mapped.hints).toContain("Laut FastBill 3 Läufe; Enddatum bitte prüfen.");
  });

  it("lehnt b2c_noneu_goods ab wie b2c_eu_goods, mit derselben Meldung", () => {
    const eu = mapFbRecurring(vorlage({ VAT_CASE: "b2c_eu_goods" }), [], TODAY);
    const noneu = mapFbRecurring(vorlage({ VAT_CASE: "b2c_noneu_goods" }), [], TODAY);
    expect(noneu.ok).toBe(false);
    expect(!eu.ok && !noneu.ok && noneu.reason.replace("b2c_noneu_goods", "X")).toBe(!eu.ok ? eu.reason.replace("b2c_eu_goods", "X") : "");
  });
});
