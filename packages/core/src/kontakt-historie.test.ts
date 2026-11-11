import { describe, expect, it } from "vitest";
import { contactEntriesOfYear, contactHistoryYear, contactYearTotals, type ContactHistoryEntry } from "./kontakt-historie.ts";

const entry = (values: Partial<ContactHistoryEntry> & Pick<ContactHistoryEntry, "date" | "net">): ContactHistoryEntry => ({
  id: `${values.date}-${values.net}`,
  number: "",
  archive: false,
  gross: Math.round(values.net * 1.19),
  counts: true,
  ...values,
});

describe("Summen je Jahr am Kontakt", () => {
  it("rechnet je Jahr in Cent, das neueste Jahr zuerst", () => {
    expect(
      contactYearTotals([
        entry({ date: "2025-02-03", net: 420_000, gross: 499_800 }),
        entry({ date: "2026-03-02", net: 400_000, gross: 476_000 }),
        entry({ date: "2026-09-01", net: 250_000, gross: 297_500 }),
      ]),
    ).toEqual([
      { year: 2026, count: 2, net: 650_000, gross: 773_500, archiveNet: 0, archiveGross: 0 },
      { year: 2025, count: 1, net: 420_000, gross: 499_800, archiveNet: 0, archiveGross: 0 },
    ]);
  });

  it("weist den Altbestand im selben Jahr getrennt aus", () => {
    expect(
      contactYearTotals([
        entry({ date: "2026-01-15", net: 100_000, gross: 119_000, archive: true }),
        entry({ date: "2026-03-02", net: 400_000, gross: 476_000 }),
      ]),
    ).toEqual([{ year: 2026, count: 2, net: 500_000, gross: 595_000, archiveNet: 100_000, archiveGross: 119_000 }]);
  });

  it("Storno und Gutschrift mindern im Jahr ihres eigenen Datums", () => {
    const totals = contactYearTotals([
      entry({ date: "2025-12-01", net: 120_000, gross: 142_800 }),
      entry({ date: "2026-01-10", net: -120_000, gross: -142_800 }),
      entry({ date: "2026-02-20", net: -42_000, gross: -49_980, archive: true }),
    ]);
    expect(totals).toEqual([
      { year: 2026, count: 2, net: -162_000, gross: -192_780, archiveNet: -42_000, archiveGross: -49_980 },
      { year: 2025, count: 1, net: 120_000, gross: 142_800, archiveNet: 0, archiveGross: 0 },
    ]);
  });

  it("ein stornierter Beleg steht im Jahr, zählt aber nicht", () => {
    expect(
      contactYearTotals([entry({ date: "2026-05-20", net: 30_000, gross: 35_700, counts: false }), entry({ date: "2025-08-03", net: 20_000, gross: 23_800 })]),
    ).toEqual([
      { year: 2026, count: 0, net: 0, gross: 0, archiveNet: 0, archiveGross: 0 },
      { year: 2025, count: 1, net: 20_000, gross: 23_800, archiveNet: 0, archiveGross: 0 },
    ]);
  });

  it("ohne Einträge gibt es keine Jahre", () => {
    expect(contactYearTotals([])).toEqual([]);
  });
});

describe("Einträge eines Jahres", () => {
  it("nur das Jahr, das neueste Datum zuerst, bei gleichem Tag die höhere Nummer", () => {
    const rows = [
      entry({ date: "2026-03-02", net: 1, number: "2026-001" }),
      entry({ date: "2025-12-30", net: 2, number: "2025-099" }),
      entry({ date: "2026-09-01", net: 3, number: "2026-002" }),
      entry({ date: "2026-09-01", net: 4, number: "2026-003" }),
    ];
    expect(contactEntriesOfYear(rows, 2026).map((r) => r.number)).toEqual(["2026-003", "2026-002", "2026-001"]);
    expect(contactEntriesOfYear(rows, 2024)).toEqual([]);
  });
});

describe("Gewähltes Jahr", () => {
  const totals = contactYearTotals([entry({ date: "2024-05-02", net: 1 }), entry({ date: "2026-03-02", net: 2 })]);

  it("ohne Wahl das neueste Jahr mit Einträgen", () => {
    expect(contactHistoryYear(totals)).toBe(2026);
  });

  it("ein gewähltes Jahr gilt auch ohne Einträge", () => {
    expect(contactHistoryYear(totals, 2025)).toBe(2025);
  });

  it("ohne Einträge und ohne Wahl keines", () => {
    expect(contactHistoryYear([])).toBeNull();
  });
});
