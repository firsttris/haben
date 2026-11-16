import { describe, expect, it } from "vitest";
import aufbau10 from "../../test-fixtures/sevdesk/buchhaltung-1.0/vat-report.json" with { type: "json" };
import zeitraeume10 from "../../test-fixtures/sevdesk/buchhaltung-1.0/vat-report-zeitraeume.json" with { type: "json" };
import aufbau20 from "../../test-fixtures/sevdesk/buchhaltung-2.0/vat-report.json" with { type: "json" };
import { sevVatReportSchema } from "./types.ts";
import { isSevVatReportArchivable, mapSevVatReport } from "./voranmeldung.ts";

/* Übermittelte Voranmeldungen aus den anonymisierten Antworten beider Buchhaltungsversionen (README in test-fixtures/sevdesk). */

const parse = (d: { objects: unknown[] }) => d.objects.map((o) => sevVatReportSchema.parse(o));
const zeitraeume = parse(zeitraeume10);

describe("sevDesk-Voranmeldungen", () => {
  it("liest Zeitraum, Übermittlung und Versteuerungsart aus 1.0", () => {
    expect(
      zeitraeume.map(mapSevVatReport).map(({ externalId, year, month, periodText, submittedAt, actualTaxation, corrected, ticket, documentId }) => ({
        externalId,
        year,
        month,
        periodText,
        submittedAt,
        actualTaxation,
        corrected,
        ticket,
        documentId,
      })),
    ).toEqual([
      {
        externalId: "vatreport/ID_20",
        year: 2023,
        month: 42,
        periodText: "quarterly 2",
        submittedAt: "2023-07-10T12:00:00+02:00",
        actualTaxation: false,
        corrected: false,
        ticket: "<anon>",
        documentId: "ID_21",
      },
      {
        externalId: "vatreport/ID_22",
        year: 2023,
        month: 44,
        periodText: "quarterly 4",
        submittedAt: "2024-01-10T12:00:00+01:00",
        actualTaxation: true,
        corrected: false,
        ticket: "<anon>",
        documentId: "ID_23",
      },
      {
        externalId: "vatreport/ID_24",
        year: 2024,
        month: 4,
        periodText: "monthly 4",
        submittedAt: "2024-05-10T12:00:00+02:00",
        actualTaxation: true,
        corrected: false,
        ticket: "<anon>",
        documentId: "ID_25",
      },
      {
        externalId: "vatreport/ID_26",
        year: 2026,
        month: 41,
        periodText: "quarterly 1",
        submittedAt: "2026-04-10T12:00:00+02:00",
        actualTaxation: true,
        corrected: false,
        ticket: "<anon>",
        documentId: "ID_27",
      },
      {
        externalId: "vatreport/ID_28",
        year: 2026,
        month: 8,
        periodText: "monthly 8",
        submittedAt: "2026-09-10T12:00:00+02:00",
        actualTaxation: true,
        corrected: false,
        ticket: "<anon>",
        documentId: "ID_29",
      },
    ]);
  });

  it("rechnet ganze Euro und Steuerbeträge in Cent, nach Kennzahl sortiert", () => {
    const mapped = mapSevVatReport(zeitraeume[4]!);
    expect(mapped.kennzahlen.map((k) => k.kz)).toEqual(["41", "42", "46", "47", "48", "61", "62", "66", "67", "81", "83", "86", "89"]);
    // "81": 100 sind volle Euro, "83": "100.00" ein Steuerbetrag
    expect(mapped.kennzahlen.find((k) => k.kz === "81")?.cents).toBe(10000);
    expect(mapped.kennzahlen.find((k) => k.kz === "62")?.cents).toBe(0);
    expect(mapped.kz83).toBe(10000);
  });

  it("liest negative Werte und Komma, lässt Unlesbares weg", () => {
    const mapped = mapSevVatReport({ ...zeitraeume[0]!, reportingValues: '{"83":"-12,34","66":"abc","x":1,"81":7}' });
    expect(mapped.kennzahlen).toEqual([
      { kz: "81", cents: 700 },
      { kz: "83", cents: -1234 },
    ]);
    expect(mapSevVatReport({ ...zeitraeume[0]!, reportingValues: "<anon>" })).toMatchObject({ kennzahlen: [], kz83: null });
  });

  it("lässt Testübermittlungen draußen, übernimmt berichtigte Anmeldungen", () => {
    const alle20 = parse(aufbau20);
    expect(alle20.filter(isSevVatReportArchivable).length).toBe(alle20.length - 1);
    expect(isSevVatReportArchivable({ ...zeitraeume[0]!, testCase: "1" })).toBe(false);
    expect(mapSevVatReport({ ...zeitraeume[0]!, corrected: "1" }).corrected).toBe(true);
  });

  it("lehnt ein unlesbares Jahr ab und lässt einen unbekannten Zeitraum offen", () => {
    // In vat-report.json aus 1.0 ist das Jahr maskiert ("1")
    expect(() => mapSevVatReport(parse(aufbau10)[0]!)).toThrow(/Jahr/);
    expect(mapSevVatReport({ ...zeitraeume[0]!, reportingPeriodCode: "yearly", reportingPeriod: "1" })).toMatchObject({ month: null, periodText: "yearly 1" });
    expect(mapSevVatReport({ ...zeitraeume[0]!, reportingPeriodCode: "monthly", reportingPeriod: "13" }).month).toBeNull();
  });

  it("liest die Version 2.0 mit maskierten Kennzahlen", () => {
    const [erste] = parse(aufbau20).map(mapSevVatReport);
    expect(erste).toMatchObject({ year: 2017, month: 41, actualTaxation: false, kennzahlen: [], kz83: null, documentId: "ID_5" });
  });
});
