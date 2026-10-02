import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoice.ts";
import { documentPosting, invoicePosting } from "./posting.ts";

const balanced = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

describe("invoicePosting", () => {
  const totals = computeInvoiceTotals([
    { quantity: 1000, unitPrice: 100_000, taxRate: 1900 },
    { quantity: 1000, unitPrice: 10_000, taxRate: 700 },
  ]);

  it("Ist-Versteuerung bucht auf USt nicht fällig (SKR03)", () => {
    const lines = invoicePosting(totals, "SKR03", "ist");
    expect(lines).toEqual([
      { account: "1400", debit: 129_700, credit: 0, taxCode: null },
      { account: "8400", debit: 0, credit: 100_000, taxCode: "USt19" },
      { account: "1766", debit: 0, credit: 19_000, taxCode: "USt19" },
      { account: "8300", debit: 0, credit: 10_000, taxCode: "USt7" },
      { account: "1761", debit: 0, credit: 700, taxCode: "USt7" },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("Soll-Versteuerung bucht direkt auf USt (SKR04)", () => {
    const lines = invoicePosting(totals, "SKR04", "soll");
    expect(lines.map((l) => l.account)).toEqual(["1200", "4400", "3806", "4300", "3801"]);
  });

  it("Storno dreht die Seiten", () => {
    const storno = computeInvoiceTotals([{ quantity: 1000, unitPrice: -100_000, taxRate: 1900 }]);
    const lines = invoicePosting(storno, "SKR03", "ist");
    expect(lines[0]).toEqual({ account: "1400", debit: 0, credit: 119_000, taxCode: null });
    expect(lines[1]).toMatchObject({ account: "8400", debit: 100_000, credit: 0 });
    expect(balanced(lines)).toBe(true);
  });
});

describe("documentPosting", () => {
  const totals = computeInvoiceTotals([
    { quantity: 1000, unitPrice: 10_000, taxRate: 1900 },
    { quantity: 1000, unitPrice: 2_000, taxRate: 700 },
  ]);

  it("Aufwand und Vorsteuer an Verbindlichkeiten (SKR03)", () => {
    const lines = documentPosting(totals, "software", "SKR03", "bank");
    expect(lines).toEqual([
      { account: "4964", debit: 10_000, credit: 0, taxCode: "VSt19" },
      { account: "1576", debit: 1_900, credit: 0, taxCode: "VSt19" },
      { account: "4964", debit: 2_000, credit: 0, taxCode: "VSt7" },
      { account: "1571", debit: 140, credit: 0, taxCode: "VSt7" },
      { account: "1600", debit: 0, credit: 14_040, taxCode: null },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("privat bezahlt an Privateinlage (SKR04)", () => {
    const lines = documentPosting(totals, "telefon", "SKR04", "privat");
    expect(lines.at(-1)).toEqual({ account: "2180", debit: 0, credit: 14_040, taxCode: null });
    expect(lines[0]?.account).toBe("6805");
  });

  it("Gutschrift dreht die Seiten", () => {
    const credit = computeInvoiceTotals([{ quantity: 1000, unitPrice: -10_000, taxRate: 1900 }]);
    const lines = documentPosting(credit, "software", "SKR03", "bank");
    expect(lines).toEqual([
      { account: "4964", debit: 0, credit: 10_000, taxCode: "VSt19" },
      { account: "1576", debit: 0, credit: 1_900, taxCode: "VSt19" },
      { account: "1600", debit: 11_900, credit: 0, taxCode: null },
    ]);
  });
});
