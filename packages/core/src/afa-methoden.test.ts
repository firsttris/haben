import { describe, expect, it } from "vitest";
import { degressiveWindow, ELEKTRO_STAFFEL, maxDegressiveRate } from "./afa-methoden.ts";
import { AssetError, assetIssues, depreciationSchedule, type ScheduleAsset } from "./afa.ts";

const total = (rows: { depreciation: number; disposal: number }[]) => rows.reduce((s, r) => s + r.depreciation + r.disposal, 0);

/** Maschine für 100.000 € im September 2025, Nutzungsdauer 10 Jahre: dreifacher linearer Satz 30 % (§ 7 Abs. 2 EStG) */
const maschine: ScheduleAsset = {
  acquisitionDate: "2025-09-15",
  cost: 10_000_000,
  method: "degressiv",
  usefulLifeMonths: 120,
  degressiveRate: 3000,
};

describe("Höchstsatz der degressiven AfA (§ 7 Abs. 2 EStG, § 52 Abs. 15 Satz 4 EStG)", () => {
  it("je Zeitraum das Vielfache des linearen Satzes, gedeckelt", () => {
    // Investitionssofortprogramm: 3-fach, höchstens 30 %
    expect(maxDegressiveRate("2025-07-01", 120)).toBe(3000);
    expect(maxDegressiveRate("2027-12-31", 156)).toBe(2307); // 13 Jahre: 3 × 7,69 % = 23,07 %
    // Wachstumschancengesetz: April bis Dezember 2024 2-fach, höchstens 20 %
    expect(maxDegressiveRate("2024-04-01", 120)).toBe(2000);
    expect(maxDegressiveRate("2024-12-31", 72)).toBe(2000);
    // Corona-Steuerhilfegesetze: 2020 bis 2022 2,5-fach, höchstens 25 %
    expect(maxDegressiveRate("2020-01-01", 240)).toBe(1250);
    expect(maxDegressiveRate("2022-12-31", 60)).toBe(2500);
  });

  it("außerhalb der Zeiträume nicht zulässig", () => {
    for (const date of ["2019-12-31", "2023-01-01", "2024-03-31", "2025-01-01", "2025-06-30", "2028-01-01"]) {
      expect(degressiveWindow(date)).toBeNull();
    }
    expect(assetIssues({ ...maschine, acquisitionDate: "2025-06-30" })).toEqual([
      "Degressive AfA nur bei Anschaffung vom 01.01.2020 bis 31.12.2022, 01.04.2024 bis 31.12.2024 und 01.07.2025 bis 31.12.2027 (§ 7 Abs. 2 EStG)",
    ]);
  });

  it("Satz über dem Höchstsatz oder ohne Satz ist ein Fehler", () => {
    expect(assetIssues({ ...maschine, usefulLifeMonths: 156 })).toEqual(["Degressiver Satz höchstens 23,07 % bei dieser Nutzungsdauer"]);
    expect(assetIssues({ ...maschine, degressiveRate: null })).toEqual(["Satz der degressiven AfA fehlt"]);
    expect(assetIssues({ ...maschine, usefulLifeMonths: null })).toEqual(["Nutzungsdauer fehlt"]);
    expect(assetIssues({ ...maschine, method: "linear" })).toEqual(["Ein degressiver Satz gehört nur zur degressiven AfA"]);
  });
});

describe("degressive AfA mit Wechsel zur linearen", () => {
  it("30 % vom Buchwert, im Anschaffungsjahr zeitanteilig, Wechsel, sobald linear höher ist", () => {
    const rows = depreciationSchedule(maschine);
    expect(rows.map((r) => [r.year, r.depreciation])).toEqual([
      [2025, 1_000_000], // 30 % × 4/12 (September bis Dezember)
      [2026, 2_700_000], // 30 % von 90.000 €
      [2027, 1_890_000],
      [2028, 1_323_000],
      [2029, 926_100],
      [2030, 648_270],
      [2031, 453_789],
      [2032, 317_652], // degressiv 3.176,52 € > linear 7.411,89 € × 12/44 = 2.021,43 €
      [2033, 277_946], // linear 7.411,89 € × 12/32 = 2.779,46 € > degressiv 2.223,57 €: Wechsel
      [2034, 277_946],
      [2035, 185_297], // Januar bis August: Rest
    ]);
    expect(rows[0]).toMatchObject({ opening: 0, addition: 10_000_000, closing: 9_000_000 });
    expect(total(rows)).toBe(10_000_000);
    expect(rows.at(-1)!.closing).toBe(0);
  });

  it("April 2024: 20 % für 9 Monate (Wachstumschancengesetz)", () => {
    const rows = depreciationSchedule({ acquisitionDate: "2024-04-10", cost: 5_000_000, method: "degressiv", usefulLifeMonths: 120, degressiveRate: 2000 });
    expect(rows.slice(0, 3).map((r) => r.depreciation)).toEqual([750_000, 850_000, 680_000]);
    expect(total(rows)).toBe(5_000_000);
  });

  it("bei kurzer Nutzungsdauer ist linear von Anfang an höher", () => {
    // 3 Jahre: linear 33,33 %, degressiv höchstens 30 %; also linear wie § 7 Abs. 1 EStG
    const asset: ScheduleAsset = { acquisitionDate: "2026-03-15", cost: 3_600_000, method: "degressiv", usefulLifeMonths: 36, degressiveRate: 3000 };
    const linear = depreciationSchedule({ ...asset, method: "linear", degressiveRate: null });
    expect(depreciationSchedule(asset)).toEqual(linear);
  });

  it("Wechsel zur linearen von Hand ab einem Jahr (§ 7 Abs. 3 Satz 1 EStG), danach nicht zurück", () => {
    const rows = depreciationSchedule({ ...maschine, linearFromYear: 2027 });
    // Ab 2027 Buchwert 63.000 € über die Restnutzungsdauer von 104 Monaten
    expect(rows.slice(0, 4).map((r) => r.depreciation)).toEqual([1_000_000, 2_700_000, 726_923, 726_923]);
    expect(total(rows)).toBe(10_000_000);
    expect(assetIssues({ ...maschine, linearFromYear: 2024 })).toEqual(["Wechsel zur linearen AfA liegt vor der Anschaffung"]);
    expect(assetIssues({ ...maschine, method: "linear", degressiveRate: null, linearFromYear: 2027 })).toEqual([
      "Den Wechsel zur linearen AfA gibt es nur bei der degressiven",
    ]);
  });

  it("Abgang: zeitanteilig bis zum Abgangsmonat, Rest als Restbuchwert", () => {
    const rows = depreciationSchedule({ ...maschine, disposalDate: "2027-03-31" });
    expect(rows.at(-1)).toEqual({ year: 2027, opening: 6_300_000, addition: 0, depreciation: 472_500, disposal: 5_827_500, closing: 0 });
  });

  it("Übernahme zum 01.01. mit dem rechnerischen Restbuchwert führt den Plan fort", () => {
    const rows = depreciationSchedule({ ...maschine, opening: { date: "2027-01-01", bookValue: 6_300_000 } });
    expect(rows.map((r) => r.depreciation)).toEqual(
      depreciationSchedule(maschine)
        .slice(2)
        .map((r) => r.depreciation),
    );
    expect(rows[0]).toMatchObject({ year: 2027, opening: 6_300_000, addition: 0 });
  });

  it("Übernahme mit abweichendem Restbuchwert oder unterjährig lehnt Haben ab", () => {
    expect(assetIssues({ ...maschine, opening: { date: "2027-01-01", bookValue: 6_000_000 } })).toEqual([
      "Restbuchwert passt nicht zur degressiven AfA (rechnerisch 63.000,00 €); dann linear übernehmen",
    ]);
    // Rundung der Vorgänger-Buchhaltung bis 1 € je Jahr ist in Ordnung
    expect(assetIssues({ ...maschine, opening: { date: "2027-01-01", bookValue: 6_300_150 } })).toEqual([]);
    expect(assetIssues({ ...maschine, opening: { date: "2027-07-01", bookValue: 6_300_000 } })).toEqual([
      "Degressive und Elektro-AfA nur zum 01.01. eines Jahres nach der Anschaffung übernehmen",
    ]);
  });
});

describe("Elektrofahrzeug nach § 7 Abs. 2a EStG", () => {
  const tesla: ScheduleAsset = { acquisitionDate: "2025-11-03", cost: 6_000_000, method: "elektro", usefulLifeMonths: null, kind: "kfz" };

  it("75/10/5/5/3/2 % der Anschaffungskosten, im Anschaffungsjahr ohne Zwölftelung", () => {
    expect(ELEKTRO_STAFFEL.reduce((s, p) => s + p, 0)).toBe(10_000);
    const rows = depreciationSchedule(tesla);
    expect(rows.map((r) => [r.year, r.depreciation])).toEqual([
      [2025, 4_500_000],
      [2026, 600_000],
      [2027, 300_000],
      [2028, 300_000],
      [2029, 180_000],
      [2030, 120_000],
    ]);
    expect(rows.at(-1)!.closing).toBe(0);
  });

  it("nur Fahrzeuge, angeschafft vom 01.07.2025 bis 31.12.2027", () => {
    expect(assetIssues({ ...tesla, acquisitionDate: "2025-06-30" })).toEqual(["AfA nach § 7 Abs. 2a EStG nur bei Anschaffung vom 01.07.2025 bis 31.12.2027"]);
    expect(assetIssues({ ...tesla, acquisitionDate: "2028-01-01" })).toHaveLength(1);
    expect(assetIssues({ ...tesla, kind: "edv" })).toEqual(["AfA nach § 7 Abs. 2a EStG nur für Fahrzeuge"]);
  });

  it("Abgang im zweiten Jahr: Staffelsatz zeitanteilig, Rest als Restbuchwert", () => {
    const rows = depreciationSchedule({ ...tesla, disposalDate: "2026-06-15" });
    expect(rows.at(-1)).toEqual({ year: 2026, opening: 1_500_000, addition: 0, depreciation: 300_000, disposal: 1_200_000, closing: 0 });
  });

  it("Übernahme zum 01.01.2027 mit 9.000 € Restbuchwert", () => {
    const rows = depreciationSchedule({ ...tesla, opening: { date: "2027-01-01", bookValue: 900_000 } });
    expect(rows.map((r) => r.depreciation)).toEqual([300_000, 300_000, 180_000, 120_000]);
    expect(assetIssues({ ...tesla, opening: { date: "2027-01-01", bookValue: 1_500_000 } })[0]).toContain("rechnerisch 9.000,00 €");
  });
});

describe("Erinnerungswert 1 €", () => {
  const auto: ScheduleAsset = { acquisitionDate: "2026-03-15", cost: 3_600_000, method: "linear", usefulLifeMonths: 72, memoValue: true };

  it("linear: 1 € bleibt stehen, im letzten Jahr 1 € weniger AfA", () => {
    const rows = depreciationSchedule(auto);
    expect(rows.map((r) => r.depreciation)).toEqual([500_000, 600_000, 600_000, 600_000, 600_000, 600_000, 99_900]);
    expect(rows.at(-1)!.closing).toBe(100);
  });

  it("bis untilYear je Jahr mit 1 € Buchwert, beim Abgang 1 € Restbuchwert", () => {
    const rows = depreciationSchedule(auto, 2034);
    expect(rows.slice(-2)).toEqual([
      { year: 2033, opening: 100, addition: 0, depreciation: 0, disposal: 0, closing: 100 },
      { year: 2034, opening: 100, addition: 0, depreciation: 0, disposal: 0, closing: 100 },
    ]);
    const sold = depreciationSchedule({ ...auto, disposalDate: "2035-05-02" });
    expect(sold.at(-1)).toEqual({ year: 2035, opening: 100, addition: 0, depreciation: 0, disposal: 100, closing: 0 });
    expect(total(sold)).toBe(3_600_000);
  });

  it("degressiv und Elektro ebenso", () => {
    expect(depreciationSchedule({ ...maschine, memoValue: true }).at(-1)).toMatchObject({ year: 2035, depreciation: 185_197, closing: 100 });
    const tesla = depreciationSchedule({ acquisitionDate: "2025-11-03", cost: 6_000_000, method: "elektro", usefulLifeMonths: null, memoValue: true });
    expect(tesla.at(-1)).toMatchObject({ year: 2030, depreciation: 119_900, closing: 100 });
  });

  it("nicht bei GWG, Sammelposten und Computern mit einem Jahr", () => {
    expect(() => depreciationSchedule({ acquisitionDate: "2026-01-01", cost: 50_000, method: "gwg", usefulLifeMonths: null, memoValue: true })).toThrow(
      AssetError,
    );
    expect(assetIssues({ acquisitionDate: "2026-01-01", cost: 100, method: "linear", usefulLifeMonths: 12, memoValue: true })).toEqual([
      "Erinnerungswert braucht mehr als 1 € Buchwert",
    ]);
  });

  it("ohne Erinnerungswert bleibt der lineare Plan unverändert", () => {
    expect(depreciationSchedule({ ...auto, memoValue: false }, 2040)).toEqual(depreciationSchedule({ ...auto, memoValue: undefined }));
    expect(depreciationSchedule({ ...auto, memoValue: false }).at(-1)).toMatchObject({ year: 2032, depreciation: 100_000, closing: 0 });
  });
});
