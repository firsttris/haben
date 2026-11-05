import { describe, expect, it } from "vitest";
import { depreciationSchedule, type ScheduleAsset } from "./afa.ts";
import { anlagenspiegelZeile, ebilanzPosition } from "./ebilanz.ts";

const PKW = "bs.ass.fixAss.tan.otherEquipm.passengerCars";
const GWG = "bs.ass.fixAss.tan.otherEquipm.gwg";

/** Buchwert am Jahresende aus der Zeile: brutto minus kumulierte AfA */
const buchwert = (z: NonNullable<ReturnType<typeof anlagenspiegelZeile>>) => z.akAnfang + z.zugaenge - z.abgaenge - (z.afaAnfang + z.afaJahr - z.afaAbgaenge);

describe.each([
  ["SKR03", "0320", "0480", "0485"],
  ["SKR04", "0520", "0670", "0675"],
] as const)("Anlagenspiegel %s", (kontenrahmen, kfz, gwg, sammelposten) => {
  const zeile = (asset: ScheduleAsset & { account: string }, year: number) => anlagenspiegelZeile(kontenrahmen, asset, depreciationSchedule(asset), year);
  // Pkw für 36.000 € im Juli 2025, sechs Jahre
  const pkw = { account: kfz, acquisitionDate: "2025-07-10", cost: 3_600_000, method: "linear" as const, usefulLifeMonths: 72 };

  it("Zugang im Anschaffungsjahr, danach Anfangsbestand, Buchwert wie im Plan", () => {
    const plan = depreciationSchedule(pkw);
    expect(zeile(pkw, 2024)).toBeNull();
    expect(zeile(pkw, 2025)).toEqual({ position: PKW, akAnfang: 0, zugaenge: 3_600_000, abgaenge: 0, afaAnfang: 0, afaJahr: 300_000, afaAbgaenge: 0 });
    const z2026 = zeile(pkw, 2026)!;
    expect(z2026).toEqual({ position: PKW, akAnfang: 3_600_000, zugaenge: 0, abgaenge: 0, afaAnfang: 300_000, afaJahr: 600_000, afaAbgaenge: 0 });
    expect(buchwert(z2026)).toBe(plan.find((r) => r.year === 2026)!.closing);
  });

  it("Erinnerungswert: nach der Nutzungsdauer 1 € Buchwert, beim Abgang gehen Kosten und AfA ab", () => {
    const memo = { ...pkw, memoValue: true };
    const z2032 = anlagenspiegelZeile(kontenrahmen, memo, depreciationSchedule(memo, 2032), 2032)!;
    expect(z2032).toMatchObject({ akAnfang: 3_600_000, afaAnfang: 3_599_900, afaJahr: 0 });
    expect(buchwert(z2032)).toBe(100);
    const verkauft = { ...memo, disposalDate: "2033-02-01" };
    const z2033 = anlagenspiegelZeile(kontenrahmen, verkauft, depreciationSchedule(verkauft), 2033)!;
    expect(z2033).toMatchObject({ abgaenge: 3_600_000, afaAbgaenge: 3_599_900 });
    expect(buchwert(z2033)).toBe(0);
  });

  it("Abgang: Anschaffungskosten und kumulierte AfA gehen ab, Buchwert 0", () => {
    const verkauft = { ...pkw, disposalDate: "2027-03-31" };
    const z = zeile(verkauft, 2027)!;
    expect(z).toMatchObject({ akAnfang: 3_600_000, abgaenge: 3_600_000, afaAnfang: 900_000, afaJahr: 150_000, afaAbgaenge: 1_050_000 });
    expect(buchwert(z)).toBe(0);
    expect(zeile(verkauft, 2028)).toBeNull();
  });

  it("Voll abgeschrieben, noch im Bestand: bleibt mit Buchwert 0", () => {
    const z = zeile(pkw, 2032)!;
    expect(z).toMatchObject({ akAnfang: 3_600_000, afaAnfang: 3_600_000, afaJahr: 0 });
    expect(buchwert(z)).toBe(0);
  });

  it("Übernahme mit Buchwert: Anschaffungskosten und AfA vor der Übernahme", () => {
    const alt = { ...pkw, opening: { date: "2026-01-01", bookValue: 2_700_000 } };
    const z = zeile(alt, 2026)!;
    expect(z).toMatchObject({ akAnfang: 3_600_000, zugaenge: 0, afaAnfang: 900_000 });
    expect(buchwert(z)).toBe(depreciationSchedule(alt).find((r) => r.year === 2026)!.closing);
    expect(zeile(alt, 2025)).toBeNull();
  });

  it("GWG: Zugang und Abgang im selben Jahr; Sammelposten scheidet nach fünf Jahren aus", () => {
    const laptop = { account: gwg, acquisitionDate: "2026-05-02", cost: 70_000, method: "gwg" as const, usefulLifeMonths: null };
    expect(zeile(laptop, 2026)).toEqual({ position: GWG, akAnfang: 0, zugaenge: 70_000, abgaenge: 70_000, afaAnfang: 0, afaJahr: 70_000, afaAbgaenge: 70_000 });
    expect(zeile(laptop, 2027)).toBeNull();
    const pool = { account: sammelposten, acquisitionDate: "2026-05-02", cost: 90_000, method: "sammelposten" as const, usefulLifeMonths: null };
    expect(buchwert(zeile(pool, 2028)!)).toBe(36_000);
    expect(zeile(pool, 2030)).toMatchObject({ abgaenge: 90_000, afaAbgaenge: 90_000, afaJahr: 18_000 });
    expect(zeile(pool, 2031)).toBeNull();
  });
});

describe("ebilanzPosition", () => {
  it.each([
    ["SKR03", "1200", -1, "bs.eqLiab.liab.bank.other"],
    ["SKR04", "1800", 1, "bs.ass.currAss.cashEquiv.bank"],
    ["SKR04", "6300", 1, "is.netIncome.regular.operatingTC.otherCost.miscellaneous"],
    // Ohne feste Position: Auffangposition des DATEV-Postens
    ["SKR04", "6450", 1, "is.netIncome.regular.operatingTC.otherCost.misc"],
    ["SKR03", "4100", 1, "is.netIncome.regular.operatingTC.staff.misc"],
    // Wareneinkauf (Handelsware): bezogene Waren
    ["SKR03", "3200", 1, "is.netIncome.regular.operatingTC.grossTradingProfit.materialServices.material.purchased.unknownVAT"],
    ["SKR04", "5200", 1, "is.netIncome.regular.operatingTC.grossTradingProfit.materialServices.material.purchased.unknownVAT"],
    // Anlagevermögen ohne Anlagenspiegel und Steuern ohne Art: keine
    ["SKR04", "0010", 1, null],
    ["SKR04", "7640", 1, null],
  ] as const)("%s %s Saldo %i → %s", (kontenrahmen, account, saldo, position) => {
    expect(ebilanzPosition(kontenrahmen, account, saldo)).toBe(position);
  });
});
