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

const EMPTY = { kz81: 0, tax81: 0, kz86: 0, tax86: 0, kz87: 0, kz41: 0, kz43: 0, kz21: 0, kz45: 0, kz60: 0, steuerfrei: 0, oss: 0, otherBase: 0, kz66: 0 };

function zeroRated(taxType: string, date: string, net: number, extra: Partial<LegacyVatVoucher> = {}): LegacyVatVoucher {
  return {
    direction: "einnahme",
    date,
    net,
    tax: 0,
    gross: net,
    taxes: [{ rate: 0, net, tax: 0 }],
    payments: [{ date: "2025-08-05", amount: net }],
    taxType,
    ...extra,
  };
}

describe("legacyVatByMonth", () => {
  it("bucht bei Soll nach Belegdatum, Vorsteuer nach Belegdatum", () => {
    expect(legacyVatByMonth([invoice, purchase, creditNote], "soll")).toEqual([
      { ...EMPTY, month: "2025-03", kz81: 90_000, tax81: 17_100, kz86: 10_000, tax86: 700, kz66: 1_900 },
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
      { ...EMPTY, month: "2025-06", otherBase: 50_000 },
    ]);
  });

  it("ordnet die Steuerarten aus Lexoffice ihren Kennzahlen zu", () => {
    const vouchers = [
      zeroRated("intraCommunitySupply", "2025-07-10", 1_000),
      zeroRated("externalService13b", "2025-07-11", 2_000),
      zeroRated("constructionService13b", "2025-07-12", 3_000),
      zeroRated("thirdPartyCountryService", "2025-07-13", 4_000),
      zeroRated("thirdPartyCountryDelivery", "2025-07-14", 5_000),
      zeroRated("photovoltaicEquipment", "2025-07-15", 6_000),
      zeroRated("vatfree", "2025-07-16", 7_000),
      zeroRated("somethingNew", "2025-07-17", 8_000),
      // OSS: auch zu 19 % (etwa Zypern) nicht in Kz 81
      { ...invoice, date: "2025-07-18", payments: [], taxType: "net", taxSubType: "distanceSales" },
    ];
    expect(legacyVatByMonth(vouchers, "soll")).toEqual([
      { ...EMPTY, month: "2025-07", kz41: 1_000, kz21: 2_000, kz60: 3_000, kz45: 4_000, kz43: 5_000, kz87: 6_000, steuerfrei: 7_000, otherBase: 8_000, oss: 110_000 },
    ]);
  });

  it("meldet bei Ist innergemeinschaftliche Lieferungen und § 13b nach Belegdatum, den Rest nach Zahlung", () => {
    const months = legacyVatByMonth(
      [
        zeroRated("intraCommunitySupply", "2025-07-10", 1_000),
        zeroRated("externalService13b", "2025-07-11", 2_000),
        zeroRated("constructionService13b", "2025-07-12", 3_000),
        zeroRated("thirdPartyCountryService", "2025-07-13", 4_000),
      ],
      "ist",
    );
    expect(months).toEqual([
      { ...EMPTY, month: "2025-07", kz41: 1_000, kz21: 2_000, kz60: 3_000 },
      { ...EMPTY, month: "2025-08", kz45: 4_000 },
    ]);
  });
});
