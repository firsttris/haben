import { describe, expect, it } from "vitest";
import { baseRateIsCurrent, baseRateRefreshDue, lastBaseRateChange, parseBaseRateCsv } from "./base-rate.ts";

// Gekürzte Antwort der Bundesbank vom November 2026 (BBIN1.M.DE.BBK.BBKBAS2.EUR.ME, lastNObservations=1)
const HEADER =
  "﻿DATAFLOW;BBK_STD_FREQ;BBK_STD_AREA;BBK_IRCBR_REF_SEC;BBK_IRCBR_CATEGORY;BBK_STD_CURRENCY;BBK_IRCBR_SUFFIX;TIME_PERIOD;OBS_VALUE;TIME_FORMAT;BBK_DECIMALS;BBK_ID;BBK_UNIT;BBK_UNIT_MULT;BBK_TITLE";
const row = (month: string, value: string) =>
  `BBK:BBIN1(1.0);M;DE;BBK;BBKBAS2;EUR;ME;${month};${value};P1M;2;BBIN1.M.DE.BBK.BBKBAS2.EUR.ME;% p.a.;0;Basiszinssatz gemäß BGB / Stand am Monatsende / SU0115`;

describe("parseBaseRateCsv", () => {
  it("liest Monat und Satz in Basispunkten", () => {
    expect(parseBaseRateCsv(`${HEADER}\r\n${row("2026-09", "1.52")}\r\n`)).toEqual({ month: "2026-09", basisPoints: 152 });
  });

  it("nimmt bei mehreren Zeilen den jüngsten Monat, auch negative Sätze", () => {
    expect(parseBaseRateCsv([HEADER, row("2016-08", "-0.88"), row("2016-07", "-0.88"), row("2016-06", "-0.83")].join("\n"))).toEqual({
      month: "2016-08",
      basisPoints: -88,
    });
  });

  it("null ohne passende Spalten oder Werte", () => {
    expect(parseBaseRateCsv("")).toBeNull();
    expect(parseBaseRateCsv('{"status":404}')).toBeNull();
    expect(parseBaseRateCsv(`${HEADER}\n${row("2026-09", "")}`)).toBeNull();
  });
});

describe("Halbjahr des Basiszinssatzes", () => {
  it("ändert sich zum 1. Januar und 1. Juli", () => {
    expect(lastBaseRateChange("2026-06-30")).toBe("2026-01");
    expect(lastBaseRateChange("2026-07-01")).toBe("2026-07");
  });

  it("der Wert von Ende Dezember gilt im Januar nicht mehr sicher", () => {
    expect(baseRateIsCurrent("2026-09", "2026-11-07")).toBe(true);
    expect(baseRateIsCurrent("2026-12", "2027-01-15")).toBe(false);
    expect(baseRateIsCurrent("2026-06", "2026-07-20")).toBe(false);
  });
});

describe("baseRateRefreshDue", () => {
  it("nur mit Haken und nur, solange das laufende Halbjahr nicht bestätigt ist", () => {
    expect(baseRateRefreshDue({}, "2027-01-02")).toBe(false);
    expect(baseRateRefreshDue({ autoBaseRate: false, baseRateSince: null }, "2027-01-02")).toBe(false);
    expect(baseRateRefreshDue({ autoBaseRate: true }, "2026-11-07")).toBe(true);
    expect(baseRateRefreshDue({ autoBaseRate: true, baseRateSince: "2026-07" }, "2026-11-07")).toBe(false);
    expect(baseRateRefreshDue({ autoBaseRate: true, baseRateSince: "2026-07" }, "2027-01-01")).toBe(true);
    expect(baseRateRefreshDue({ autoBaseRate: true, baseRateSince: "2027-01" }, "2027-06-30")).toBe(false);
  });
});
