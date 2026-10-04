import { describe, expect, it } from "vitest";
import { buildDatevBuchungsstapel, encodeCp1252, splitEntry, type DatevExportEntry, type DatevExportHeader } from "./datev-export.ts";
import { parseDatevBuchungsstapel } from "./datev.ts";

const header: DatevExportHeader = {
  beraterNr: "1001",
  mandantNr: "12345",
  fiscalYearStart: "2026-01-01",
  dateFrom: "2026-01-01",
  dateTo: "2026-12-31",
  description: "Haben 2026",
  kontenrahmen: "SKR03",
  createdAt: new Date(2026, 9, 4, 12, 0, 0, 0),
};

// Rechnung (Ist-Versteuerung), Zahlungseingang mit Umbuchung der Steuer, Beleg mit Privatanteil
const entries: DatevExportEntry[] = [
  {
    date: "2026-09-01",
    description: "Rechnung 2026-001 · Nordwerk Software GmbH",
    voucher: "2026-001",
    locked: true,
    lines: [
      { account: "1400", debit: 119_000, credit: 0 },
      { account: "8400", debit: 0, credit: 100_000 },
      { account: "1766", debit: 0, credit: 19_000 },
    ],
  },
  {
    date: "2026-09-20",
    description: "Zahlung Rechnung 2026-001",
    voucher: "2026-001",
    locked: true,
    lines: [
      { account: "1200", debit: 119_000, credit: 0 },
      { account: "1400", debit: 0, credit: 119_000 },
      { account: "1766", debit: 19_000, credit: 0 },
      { account: "1776", debit: 0, credit: 19_000 },
    ],
  },
  {
    date: "2026-09-25",
    description: "Mobilfunk Funknetz, 20 % privat, Gerät",
    voucher: "MF-0815 / 9",
    locked: true,
    lines: [
      { account: "4920", debit: 3_200, credit: 0 },
      { account: "1576", debit: 608, credit: 0 },
      { account: "1800", debit: 952, credit: 0 },
      { account: "1600", debit: 0, credit: 4_760 },
    ],
  },
];

describe("DATEV-Buchungsstapel", () => {
  it("zerlegt Buchungen in Konto an Gegenkonto und setzt BU 40 auf Automatikkonten", () => {
    expect(splitEntry(entries[0]!, "SKR03").map((r) => [r.amount, r.account, r.contraAccount, r.buKey])).toEqual([
      [100_000, "1400", "8400", "40"],
      [19_000, "1400", "1766", ""],
    ]);
    expect(splitEntry(entries[2]!, "SKR03").map((r) => [r.amount, r.account, r.contraAccount])).toEqual([
      [3_200, "4920", "1600"],
      [952, "1800", "1600"],
      [608, "1576", "1600"],
    ]);
    expect(() => splitEntry({ ...entries[0]!, lines: [{ account: "1400", debit: 1, credit: 0 }] }, "SKR03")).toThrow(/nicht ausgeglichen/);
  });

  it("liest sich mit dem DATEV-Parser wieder ein, Salden je Konto wie im Journal", () => {
    const { bytes } = buildDatevBuchungsstapel(header, entries);
    const stack = parseDatevBuchungsstapel(bytes);
    expect(stack.warnings).toEqual([]);
    expect(stack.header).toMatchObject({ beraterNr: "1001", mandantNr: "12345", fiscalYearStart: "2026-01-01", kontenrahmen: "SKR03", accountLength: 4 });
    const saldo = new Map<string, number>();
    const add = (account: string, value: number) => saldo.set(account, (saldo.get(account) ?? 0) + value);
    for (const b of stack.bookings) {
      add(b.account, b.side === "S" ? b.amount : -b.amount);
      add(b.contraAccount, b.side === "S" ? -b.amount : b.amount);
    }
    const expected = new Map<string, number>();
    for (const e of entries) for (const l of e.lines) expected.set(l.account, (expected.get(l.account) ?? 0) + l.debit - l.credit);
    for (const [account, value] of expected) expect(saldo.get(account) ?? 0, account).toBe(value);
    const first = stack.bookings[0]!;
    expect(first).toMatchObject({ date: "2026-09-01", voucherField1: "2026-001", buKey: "40", text: "Rechnung 2026-001 · Nordwerk Software GmbH" });
    // Belegfeld 1 nur mit erlaubten Zeichen; Umlaute in Windows-1252
    expect(stack.bookings.at(-1)).toMatchObject({ voucherField1: "MF-0815/9", text: "Mobilfunk Funknetz, 20 % privat, Gerät" });
  });

  it("prüft Berater- und Mandantennummer und kodiert Windows-1252", () => {
    expect(() => buildDatevBuchungsstapel({ ...header, beraterNr: "" }, entries)).toThrow(/Beraternummer/);
    expect(() => buildDatevBuchungsstapel({ ...header, mandantNr: "123456" }, entries)).toThrow(/Mandantennummer/);
    expect([...encodeCp1252("Ä€„✓")]).toEqual([0xc4, 0x80, 0x84, 0x3f]);
  });
});
