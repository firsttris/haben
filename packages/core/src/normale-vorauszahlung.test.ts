import { describe, expect, it } from "vitest";
import { advanceBalancePlan } from "./anzahlung-bilanz.ts";
import { advanceVatPlan } from "./anzahlung-steuer.ts";
import { totalsFromTaxes } from "./invoice.ts";
import { ACCOUNTS, invoicePaymentPosting, type PostingLine, type TaxShare } from "./posting.ts";

const total: TaxShare[] = [{ rate: 1900, base: 70_000, tax: 13_300 }];
const part: TaxShare[] = [{ rate: 1900, base: 10_000, tax: 1_900 }];
const rest: TaxShare[] = [{ rate: 1900, base: 60_000, tax: 11_400 }];
const performance = { date: "2026-01-20", performance: 1 as const };

function balances(lines: readonly PostingLine[]) {
  const sums: Record<string, number> = {};
  for (const line of lines) sums[line.account] = (sums[line.account] ?? 0) + line.debit - line.credit;
  return Object.fromEntries(Object.entries(sums).filter(([, amount]) => amount !== 0));
}

/** § 13 Abs. 1 Nr. 1 a Satz 4/b UStG und § 252/266 HGB: derselbe gespeicherte Centanteil in beiden Verfahren. */
describe.each(["SKR03", "SKR04"] as const)("Normale Vorauszahlung %s ohne Datenbank", (frame) => {
  it.each(["ist", "soll"] as const)("119 € vor Leistung und 714 € danach bei %s", (mode) => {
    const accounts = ACCOUNTS[frame];
    const payments = [
      { date: "2025-12-13", paid: part },
      { date: "2026-02-13", paid: rest },
    ];
    const tax = advanceVatPlan(total, [...payments, ...(mode === "soll" ? [performance] : [])]);
    expect(tax).toEqual([
      { date: "2025-12-13", shares: part },
      { date: mode === "soll" ? "2026-01-20" : "2026-02-13", shares: rest },
    ]);
    const planned = [
      ...payments.map(({ date, paid }) => ({
        date,
        lines: invoicePaymentPosting(totalsFromTaxes(total), paid[0]!.base + paid[0]!.tax, frame, "soll", paid),
      })),
      ...tax.map(({ date, shares }) => ({ date, lines: invoicePaymentPosting(totalsFromTaxes(shares), 0, frame, "ist", shares) })),
      ...advanceBalancePlan(total, [...payments, performance], frame),
    ];
    const at = (cutoff: string) => balances(planned.filter(({ date }) => date <= cutoff).flatMap(({ lines }) => lines));
    expect(at("2025-12-31")).toEqual({ [accounts.bank]: 11_900, [accounts.erhalteneAnzahlungen]: -10_000, [accounts.ust[1900]]: -1_900 });
    expect(at("2026-01-31")).toEqual({
      [accounts.bank]: 11_900,
      [accounts.forderungen]: 71_400,
      [accounts.erloese[1900]]: -70_000,
      [accounts.ust[1900]]: mode === "soll" ? -13_300 : -1_900,
      ...(mode === "ist" ? { [accounts.ustNichtFaellig[1900]]: -11_400 } : {}),
    });
    expect(at("2026-02-28")).toEqual({ [accounts.bank]: 83_300, [accounts.erloese[1900]]: -70_000, [accounts.ust[1900]]: -13_300 });
  });
});

it("datierte Korrektur mindert im neuen Verfahren erhaltene Steuer erst mit der gespeicherten Erstattung", () => {
  const negative = (shares: TaxShare[]) => shares.map((share) => ({ ...share, base: -share.base, tax: -share.tax }));
  expect(
    advanceVatPlan(total, [
      { date: "2025-12-13", paid: part },
      performance,
      { date: "2026-01-25", correction: negative(total), untilRefund: true },
      { date: "2026-02-13", paid: negative(part) },
    ]),
  ).toEqual([
    { date: "2025-12-13", shares: part },
    { date: "2026-01-20", shares: rest },
    { date: "2026-01-25", shares: negative(rest) },
    { date: "2026-02-13", shares: negative(part) },
  ]);
});
