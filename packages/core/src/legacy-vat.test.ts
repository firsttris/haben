import { describe, expect, it } from "vitest";
import { legacyVatByMonth, type LegacyVatVoucher } from "./legacy-vat.ts";

const invoice: LegacyVatVoucher = {
  direction: "einnahme",
  date: "2025-03-28",
  net: 110_000,
  tax: 19_700,
  gross: 129_700,
  taxes: [
    { rate: 1900, net: 100_000, tax: 19_000 },
    { rate: 700, net: 10_000, tax: 700 },
  ],
  payments: [
    { date: "2025-04-02", amount: 64_850 },
    { date: "2025-05-10", amount: 64_850 },
  ],
};
const purchase: LegacyVatVoucher = {
  direction: "ausgabe",
  date: "2025-03-15",
  net: 10_000,
  tax: 1_900,
  gross: 11_900,
  taxes: [{ rate: 1900, net: 10_000, tax: 1_900 }],
  payments: [{ date: "2025-04-20", amount: 11_900 }],
};
const creditNote: LegacyVatVoucher = {
  direction: "einnahme",
  date: "2025-03-30",
  net: -10_000,
  tax: -1_900,
  gross: -11_900,
  taxes: [{ rate: 1900, net: -10_000, tax: -1_900 }],
  payments: [{ date: "2025-04-05", amount: -11_900 }],
};

describe("legacyVatByMonth", () => {
  it("bucht bei Soll nach Belegdatum, Vorsteuer nach Belegdatum", () => {
    expect(legacyVatByMonth([invoice, purchase, creditNote], "soll")).toEqual([
      { month: "2025-03", kz81: 90_000, tax81: 17_100, kz86: 10_000, tax86: 700, otherBase: 0, kz66: 1_900 },
    ]);
  });

  it("verteilt bei Ist die Zahlungen anteilig auf die Monate", () => {
    const months = legacyVatByMonth([invoice, purchase, creditNote], "ist");
    expect(months.map((m) => m.month)).toEqual(["2025-03", "2025-04", "2025-05"]);
    expect(months[0]).toMatchObject({ kz81: 0, kz66: 1_900 });
    expect(months[1]).toMatchObject({ kz81: 50_000 - 10_000, tax81: 9_500 - 1_900, kz86: 5_000, tax86: 350 });
    expect(months[2]).toMatchObject({ kz81: 50_000, tax81: 9_500, kz86: 5_000, tax86: 350 });
  });

  it("lässt unbezahlte Rechnungen bei Ist weg und führt andere Sätze getrennt", () => {
    const unpaid = { ...invoice, payments: [] };
    const exempt: LegacyVatVoucher = {
      direction: "einnahme",
      date: "2025-06-01",
      net: 50_000,
      tax: 0,
      gross: 50_000,
      taxes: [{ rate: 0, net: 50_000, tax: 0 }],
      payments: [{ date: "2025-06-03", amount: 50_000 }],
    };
    expect(legacyVatByMonth([unpaid, exempt], "ist")).toEqual([
      { month: "2025-06", kz81: 0, tax81: 0, kz86: 0, tax86: 0, otherBase: 50_000, kz66: 0 },
    ]);
  });
});
