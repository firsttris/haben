import { describe, expect, it } from "vitest";
import { advanceBalanceDifference, advanceBalancePlan, type AdvanceBalanceChange, type AdvanceBalanceEvent } from "./anzahlung-bilanz.ts";
import { advanceVatPlan } from "./anzahlung-steuer.ts";
import { totalsFromTaxes } from "./invoice.ts";
import { ACCOUNTS, invoicePaymentPosting, invoiceWriteOffPosting, side, type Kontenrahmen, type PostingLine, type TaxShare } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";

/** Soll minus Haben; ausgeglichene Konten nicht ausgeben. */
function balances(lines: readonly PostingLine[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of lines) result[line.account] = (result[line.account] ?? 0) + line.debit - line.credit;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== 0));
}

function ledger(total: TaxShare[], events: AdvanceBalanceEvent[], frame: Kontenrahmen, treatment: TaxTreatment = "regulaer") {
  const totals = totalsFromTaxes(total);
  const lines = events.flatMap((event) => {
    const paid = event.paid ?? [];
    const amount = paid.reduce((sum, share) => sum + share.base + share.tax, 0);
    const writtenOff = event.writtenOff ?? [];
    const writtenOffGross = writtenOff.reduce((sum, share) => sum + share.base + share.tax, 0);
    return [
      ...invoicePaymentPosting(totals, amount, frame, "soll", paid, treatment),
      ...(event.kind ? invoiceWriteOffPosting(event.kind, totals, writtenOffGross, frame, "ist", treatment, writtenOff) : []),
    ];
  });
  const vat = advanceVatPlan(total, events).flatMap(({ shares }) => invoicePaymentPosting(totalsFromTaxes(shares), 0, frame, "ist", shares, treatment));
  return balances([...lines, ...vat, ...advanceBalancePlan(total, events, frame, treatment).flatMap((change) => change.lines)]);
}

const total: TaxShare[] = [{ rate: 1900, base: 10_000, tax: 1_900 }];
const negative = (shares: readonly TaxShare[]) => shares.map((share) => ({ ...share, base: -share.base, tax: -share.tax }));

describe("Differenz zweier Anzahlungspläne", () => {
  const lines = [side("1400", 2_975, true, null), side("1710", 2_500, false, null), side("1766", 475, false, null)];
  const before: AdvanceBalanceChange[] = [{ date: "2026-12-01", lines }];

  it("bucht eine nachträgliche Datumsänderung am alten Tag gegen und am neuen Tag zu", () => {
    const after = [{ date: "2026-11-30", lines }];
    expect(advanceBalanceDifference(before, after)).toEqual([
      { date: "2026-11-30", lines },
      { date: "2026-12-01", lines: [side("1400", 2_975, false, null), side("1710", 2_500, true, null), side("1766", 475, true, null)] },
    ]);
  });

  it("fasst je Datum und Konto zusammen und lässt vollständig aufgehobene Zeilen weg", () => {
    const after: AdvanceBalanceChange[] = [
      { date: "2026-12-01", lines: [...lines, side("1710", 500, false, null), side("1400", 595, true, null)] },
      { date: "2026-12-01", lines: [side("1766", 95, false, null)] },
    ];
    expect(advanceBalanceDifference(before, after)).toEqual([
      { date: "2026-12-01", lines: [side("1400", 595, true, null), side("1710", 500, false, null), side("1766", 95, false, null)] },
    ]);
    expect(advanceBalanceDifference(before, before)).toEqual([]);
  });
});

describe("Anzahlungsanforderung ohne Zahlung", () => {
  it("bucht weder die offene Anforderung noch deren Korrektur", () => {
    expect(advanceBalancePlan(total, [], "SKR03")).toEqual([]);
    expect(advanceBalancePlan(total, [{ date: "2026-12-01", correction: negative(total) }], "SKR04")).toEqual([]);
  });
});

describe.each([
  ["SKR03", 1900, 1_900, "regulaer", "8400"],
  ["SKR04", 700, 700, "regulaer", "4300"],
  ["SKR03", 0, 0, "regulaer", "8200"],
  ["SKR04", 0, 0, "kleinunternehmer", "4184"],
] as const)("Anzahlungsanteil %s, Satz %i, Steuer %i, %s", (frame, rate, tax, treatment, revenue) => {
  const shares: TaxShare[] = [{ rate, base: 10_000, tax }];
  const part: TaxShare[] = [{ rate, base: 2_500, tax: tax / 4 }];
  const a = ACCOUNTS[frame];
  const vatAccount = rate === 1900 ? a.ust[1900] : a.ust[700];
  const taxes = tax ? { [vatAccount]: -tax } : {};

  it("zeigt bei Teilzahlung nur die erhaltene Nettoanzahlung und die entstandene Steuer", () => {
    expect(ledger(shares, [{ date: "2026-12-01", paid: part }], frame, treatment)).toEqual({
      [a.bank]: 2_500 + tax / 4,
      [a.erhalteneAnzahlungen]: -2_500,
      ...(tax ? { [vatAccount]: -tax / 4 } : {}),
    });
  });

  it("löst eine volle Vorauszahlung im Leistungsjahr genau einmal in Erlös auf", () => {
    const events: AdvanceBalanceEvent[] = [
      { date: "2026-12-01", paid: shares },
      { date: "2027-01-15", performance: 1 },
    ];
    expect(ledger(shares, events, frame, treatment)).toEqual({ [a.bank]: 10_000 + tax, [revenue]: -10_000, ...taxes });
    expect(advanceBalancePlan(shares, events, frame, treatment).map((change) => change.date)).toEqual(["2026-12-01", "2027-01-15"]);
  });

  it("realisiert ohne Zahlung die volle Forderung; verspätete Zahlung erzeugt keinen zweiten Erlös", () => {
    const events: AdvanceBalanceEvent[] = [{ date: "2027-01-15", performance: 1 }];
    const notDue = rate === 1900 ? a.ustNichtFaellig[1900] : a.ustNichtFaellig[700];
    expect(balances(advanceBalancePlan(shares, events, frame, treatment).flatMap((change) => change.lines))).toEqual({
      [a.forderungen]: 10_000 + tax,
      [revenue]: -10_000,
      ...(tax ? { [notDue]: -tax } : {}),
    });
    const later = [...events, { date: "2027-02-01", paid: shares }];
    expect(advanceBalancePlan(shares, later, frame, treatment)).toEqual(advanceBalancePlan(shares, events, frame, treatment));
    expect(ledger(shares, later, frame, treatment)).toEqual({ [a.bank]: 10_000 + tax, [revenue]: -10_000, ...taxes });
  });
});

describe("Datierte Zielstandsdifferenzen", () => {
  it("sortiert rückdatierte Ereignisse und fasst denselben Tag vor der Differenzbildung zusammen", () => {
    const events: AdvanceBalanceEvent[] = [
      { date: "2027-01-15", paid: [{ rate: 1900, base: 7_500, tax: 1_425 }] },
      { date: "2026-12-01", paid: [{ rate: 1900, base: 2_500, tax: 475 }] },
      { date: "2027-01-15", performance: 1 },
    ];
    const plan = advanceBalancePlan(total, events, "SKR03");
    expect(plan.map((change) => change.date)).toEqual(["2026-12-01", "2027-01-15"]);
    expect(advanceBalancePlan(total, [...events].reverse(), "SKR03")).toEqual(plan);
    expect(balances(plan[1]!.lines)).toEqual({ "1400": 8_925, "1710": 2_500, "8400": -10_000, "1766": -1_425 });
    expect(ledger(total, events, "SKR03")).toEqual({ "1200": 11_900, "8400": -10_000, "1776": -1_900 });
  });

  it("verwendet die gespeicherten Centanteile statt jede Zahlung neu zu runden", () => {
    const events: AdvanceBalanceEvent[] = [
      { date: "2026-12-01", paid: [{ rate: 1900, base: 3_333, tax: 634 }] },
      { date: "2026-12-02", paid: [{ rate: 1900, base: 3_333, tax: 633 }] },
      { date: "2026-12-03", paid: [{ rate: 1900, base: 3_334, tax: 633 }] },
    ];
    const plan = advanceBalancePlan(total, events, "SKR04");
    expect(balances(plan[2]!.lines)).toEqual({ "1200": 3_967, "3250": -3_334, "3816": -633 });
    expect(ledger(total, events, "SKR04")).toEqual({ "1800": 11_900, "3250": -10_000, "3806": -1_900 });
  });

  it("trennt gemischte Sätze und erzeugt weder Melde-Steuerschlüssel noch Bemessungsgrundlagen", () => {
    const shares: TaxShare[] = [
      { rate: 1900, base: 10_000, tax: 1_900 },
      { rate: 700, base: 5_000, tax: 350 },
      { rate: 0, base: 2_000, tax: 0 },
    ];
    const plan = advanceBalancePlan(
      shares,
      [
        { date: "2026-12-01", paid: shares },
        { date: "2027-01-15", performance: 1 },
      ],
      "SKR03",
    );
    expect(plan).toHaveLength(2);
    expect(balances(plan.flatMap((change) => change.lines))).toEqual({
      "1400": 19_250,
      "8400": -10_000,
      "8300": -5_000,
      "8200": -2_000,
      "1766": -1_900,
      "1761": -350,
    });
    for (const { lines } of plan) {
      expect(lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
      for (const line of lines) {
        expect(line.taxCode).toBeNull();
        expect(line).not.toHaveProperty("basis");
      }
    }
  });

  it("nimmt durch Rechnungsstorno und Ersatzschlussrechnung eine erbrachte Leistung nicht zurück", () => {
    const before: AdvanceBalanceEvent[] = [
      { date: "2026-12-01", paid: total },
      { date: "2027-01-15", performance: 1 },
    ];
    const after: AdvanceBalanceEvent[] = [...before, { date: "2027-02-01", performance: -1 }, { date: "2027-03-01", performance: 1 }];
    expect(advanceBalancePlan(total, before, "SKR03")).toHaveLength(2);
    expect(advanceBalancePlan(total, after, "SKR03")).toEqual(advanceBalancePlan(total, before, "SKR03"));
  });
});

describe("Echte Korrektur und tatsächliche Erstattung", () => {
  it("behält vor Leistung eine erhaltene Anzahlung bis zur tatsächlichen Erstattung", () => {
    const events: AdvanceBalanceEvent[] = [
      { date: "2026-12-01", paid: total },
      { date: "2026-12-02", correction: negative(total) },
    ];
    expect(ledger(total, events, "SKR03")).toEqual({ "1200": 11_900, "1710": -10_000, "1776": -1_900 });
    const refunded = [...events, { date: "2026-12-03", paid: negative(total) }];
    expect(ledger(total, refunded, "SKR03")).toEqual({});
    expect(balances(advanceBalancePlan(total, refunded, "SKR03").at(-1)!.lines)).toEqual({ "1400": -11_900, "1710": 10_000, "1766": 1_900 });
  });

  it("hebt nach Leistung durch echte Korrektur den Erlös auf; die Auszahlung bleibt in der normalen Zahlung", () => {
    const events: AdvanceBalanceEvent[] = [
      { date: "2026-12-01", paid: total },
      { date: "2027-01-15", performance: 1 },
      { date: "2027-02-01", correction: negative(total) },
    ];
    expect(ledger(total, events, "SKR04")).toEqual({ "1800": 11_900, "1200": -11_900 });
    expect(ledger(total, [...events, { date: "2027-02-02", paid: negative(total) }], "SKR04")).toEqual({});
  });

  it("bildet eine echte Zahlungsgegenzeile vor Leistung spiegelbildlich ab", () => {
    const events: AdvanceBalanceEvent[] = [
      { date: "2026-12-01", paid: total },
      { date: "2026-12-02", paid: negative(total) },
    ];
    const plan = advanceBalancePlan(total, events, "SKR04");
    expect(plan).toHaveLength(2);
    expect(balances(plan.flatMap((change) => change.lines))).toEqual({});
    expect(ledger(total, events, "SKR04")).toEqual({});
  });
});

describe.each([
  ["SKR03", "skonto", "8730"],
  ["SKR04", "forderungsausfall", "6930"],
] as const)("Ausbuchung %s %s", (frame, kind, expense) => {
  const a = ACCOUNTS[frame];
  const paid = [{ rate: 1900, base: 9_800, tax: 1_862 }];
  const writtenOff = [{ rate: 1900, base: 200, tax: 38 }];
  const settled: AdvanceBalanceEvent[] = [
    { date: "2026-12-01", paid },
    { date: "2026-12-02", writtenOff, kind },
  ];

  it("neutralisiert vor Leistung den normalen Aufwand; bei Leistung entsteht er genau einmal", () => {
    expect(ledger(total, settled, frame)).toEqual({ [a.bank]: 11_662, [a.erhalteneAnzahlungen]: -9_800, [a.ust[1900]]: -1_862 });
    const performed: AdvanceBalanceEvent[] = [...settled, { date: "2027-01-15", performance: 1 }];
    expect(ledger(total, performed, frame)).toEqual({ [a.bank]: 11_662, [a.erloese[1900]]: -10_000, [expense]: 200, [a.ust[1900]]: -1_862 });
  });

  it("lässt eine erst nach Leistung erfolgte Ausbuchung im normalen Aufwand", () => {
    const performed: AdvanceBalanceEvent[] = [
      { date: "2027-01-15", performance: 1 },
      { date: "2027-02-01", paid },
      { date: "2027-02-02", writtenOff, kind },
    ];
    expect(advanceBalancePlan(total, performed, frame).map((change) => change.date)).toEqual(["2027-01-15"]);
    expect(ledger(total, performed, frame)).toEqual({ [a.bank]: 11_662, [a.erloese[1900]]: -10_000, [expense]: 200, [a.ust[1900]]: -1_862 });
  });

  it("nimmt eine echte Ausbuchungsgegenzeile vor Leistung samt Neutralisierung zurück", () => {
    const reversed: AdvanceBalanceEvent[] = [...settled, { date: "2026-12-03", writtenOff: negative(writtenOff), kind }];
    expect(ledger(total, reversed, frame)).toEqual({ [a.bank]: 11_662, [a.erhalteneAnzahlungen]: -9_800, [a.ust[1900]]: -1_862 });
  });
});

it("verlangt das tatsächliche Ausbuchungskonto statt stillschweigend Skonto anzunehmen", () => {
  expect(() => advanceBalancePlan(total, [{ date: "2026-12-01", writtenOff: total }], "SKR03")).toThrow(RangeError);
});
