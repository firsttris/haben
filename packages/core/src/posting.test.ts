import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoice.ts";
import {
  cashPosting,
  directPosting,
  documentPaymentPosting,
  documentPosting,
  invoicePaymentPosting,
  invoicePosting,
  legacyCorrectionPosting,
  openingDocumentPosting,
  openingInvoicePosting,
  paidTaxShares,
} from "./posting.ts";

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

describe("invoicePosting mit Steuerfällen", () => {
  const zero = computeInvoiceTotals([{ quantity: 1000, unitPrice: 500_000, taxRate: 0 }]);

  it("Reverse Charge, Drittland, steuerfrei und Kleinunternehmer auf eigene Erlöskonten", () => {
    expect(invoicePosting(zero, "SKR03", "ist", "reverse_charge")).toEqual([
      { account: "1400", debit: 500_000, credit: 0, taxCode: null },
      { account: "8336", debit: 0, credit: 500_000, taxCode: "RC" },
    ]);
    expect(invoicePosting(zero, "SKR04", "soll", "drittland")[1]).toMatchObject({ account: "4338", taxCode: "Drittland" });
    expect(invoicePosting(zero, "SKR03", "soll", "steuerfrei")[1]).toMatchObject({ account: "8100", taxCode: "Steuerfrei" });
    expect(invoicePosting(zero, "SKR04", "ist", "kleinunternehmer")[1]).toMatchObject({ account: "4185", taxCode: "KU" });
  });

  it("lehnt Steuersätze über 0 % bei Sonderfällen ab", () => {
    const taxed = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100, taxRate: 1900 }]);
    expect(() => invoicePosting(taxed, "SKR03", "ist", "reverse_charge")).toThrow(RangeError);
  });
});

describe("documentPosting", () => {
  it("Privatanteil: betrieblicher Teil ist Aufwand und Vorsteuer, der Rest Entnahme", () => {
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 4_000, taxRate: 1900 }]);
    const lines = documentPosting(totals, "telefon", "SKR03", "bank", true, undefined, 20);
    expect(lines).toEqual([
      { account: "4920", debit: 3_200, credit: 0, taxCode: "VSt19" },
      { account: "1576", debit: 608, credit: 0, taxCode: "VSt19" },
      { account: "1800", debit: 952, credit: 0, taxCode: null },
      { account: "1600", debit: 0, credit: 4_760, taxCode: null },
    ]);
  });

  it("§ 13b: Steuer selbst schulden und als Vorsteuer abziehen, gezahlt wird netto", () => {
    const base = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 1900 }]);
    const totals = { ...base, gross: base.net };
    const lines = documentPosting(totals, "software", "SKR03", "bank", true, undefined, 0, "eu");
    expect(lines).toEqual([
      { account: "4964", debit: 10_000, credit: 0, taxCode: "RC13bEU" },
      { account: "1577", debit: 1_900, credit: 0, taxCode: "VSt13b" },
      { account: "1787", debit: 0, credit: 1_900, taxCode: "RC13bEU" },
      { account: "1600", debit: 0, credit: 10_000, taxCode: null },
    ]);
    expect(documentPosting(totals, "software", "SKR04", "privat", true, undefined, 0, "drittland").map((l) => [l.account, l.taxCode])).toEqual([
      ["6837", "RC13bDrittland"],
      ["1407", "VSt13b"],
      ["3837", "RC13bDrittland"],
      ["2180", null],
    ]);
    // Kleinunternehmer: Steuer schulden, nicht abziehen; sie ist Aufwand
    expect(documentPosting(totals, "software", "SKR03", "bank", false, undefined, 0, "eu")).toEqual([
      { account: "4964", debit: 11_900, credit: 0, taxCode: "RC13bEU" },
      { account: "1787", debit: 0, credit: 1_900, taxCode: "RC13bEU" },
      { account: "1600", debit: 0, credit: 10_000, taxCode: null },
    ]);
    // Privatanteil: Vorsteuer nur für den betrieblichen Teil, Umsatzsteuer voll
    const shared = documentPosting(totals, "telefon", "SKR03", "bank", true, undefined, 20, "eu");
    expect(shared.find((l) => l.account === "1577")!.debit).toBe(1_520);
    expect(shared.find((l) => l.account === "1787")!.credit).toBe(1_900);
    expect(balanced(shared)).toBe(true);
  });

  it("ohne Vorsteuerabzug (Kleinunternehmer) ist die Steuer Aufwand", () => {
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 1900 }]);
    expect(documentPosting(totals, "software", "SKR03", "bank", false)).toEqual([
      { account: "4964", debit: 11_900, credit: 0, taxCode: "keineVSt" },
      { account: "1600", debit: 0, credit: 11_900, taxCode: null },
    ]);
  });

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

describe("Zahlungen", () => {
  const totals = computeInvoiceTotals([
    { quantity: 1000, unitPrice: 100_000, taxRate: 1900 },
    { quantity: 1000, unitPrice: 10_000, taxRate: 700 },
  ]);

  it("Zahlungseingang bei Ist-Versteuerung macht die USt fällig", () => {
    const lines = invoicePaymentPosting(totals, totals.gross, "SKR03", "ist");
    expect(lines).toEqual([
      { account: "1200", debit: 129_700, credit: 0, taxCode: null },
      { account: "1400", debit: 0, credit: 129_700, taxCode: null },
      { account: "1766", debit: 19_000, credit: 0, taxCode: "USt19" },
      { account: "1776", debit: 0, credit: 19_000, taxCode: "USt19" },
      { account: "1761", debit: 700, credit: 0, taxCode: "USt7" },
      { account: "1771", debit: 0, credit: 700, taxCode: "USt7" },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("Soll-Versteuerung: nur Bank an Forderungen", () => {
    expect(invoicePaymentPosting(totals, 50_000, "SKR04", "soll").map((l) => l.account)).toEqual(["1800", "1200"]);
  });

  it("Teilzahlung verteilt die Steuer anteilig und exakt", () => {
    const shares = paidTaxShares(totals, 50_000);
    expect(shares.reduce((s, r) => s + r.base + r.tax, 0)).toBe(50_000);
    expect(shares.reduce((s, r) => s + r.tax, 0)).toBe(Math.round((19_700 * 50_000) / 129_700));
  });

  it("Belegzahlung: Verbindlichkeiten an Bank", () => {
    expect(documentPaymentPosting(-4_590, "SKR03")).toEqual([
      { account: "1600", debit: 4_590, credit: 0, taxCode: null },
      { account: "1200", debit: 0, credit: 4_590, taxCode: null },
    ]);
  });

  it("Privatentnahme und Einlage", () => {
    expect(directPosting("privat", -300_000, "SKR03")).toEqual([
      { account: "1200", debit: 0, credit: 300_000, taxCode: null },
      { account: "1800", debit: 300_000, credit: 0, taxCode: null },
    ]);
    expect(directPosting("privat", 10_000, "SKR04")[1]).toEqual({ account: "2180", debit: 0, credit: 10_000, taxCode: null });
    expect(directPosting("ustVorauszahlung", -191_230, "SKR03")[1]?.account).toBe("1780");
  });
});

describe("Eröffnungsbuchungen für offene Posten aus Lexoffice", () => {
  const totals = computeInvoiceTotals([
    { quantity: 1000, unitPrice: 100_000, taxRate: 1900 },
    { quantity: 1000, unitPrice: 10_000, taxRate: 700 },
  ]);

  it("Ist: Forderung an Saldenvortrag netto und Umsatzsteuer nicht fällig", () => {
    expect(openingInvoicePosting(totals, "SKR03", "ist")).toEqual([
      { account: "1400", debit: 129_700, credit: 0, taxCode: null },
      { account: "1766", debit: 0, credit: 19_000, taxCode: null },
      { account: "1761", debit: 0, credit: 700, taxCode: null },
      { account: "9000", debit: 0, credit: 110_000, taxCode: null },
    ]);
  });

  it("Soll: Forderung an Saldenvortrag brutto, die Steuer ist schon angemeldet", () => {
    expect(openingInvoicePosting(totals, "SKR04", "soll")).toEqual([
      { account: "1200", debit: 129_700, credit: 0, taxCode: null },
      { account: "9000", debit: 0, credit: 129_700, taxCode: null },
    ]);
  });

  it("Beleg: Saldenvortrag an Verbindlichkeiten", () => {
    expect(openingDocumentPosting(11_900, "SKR03")).toEqual([
      { account: "9000", debit: 11_900, credit: 0, taxCode: null },
      { account: "1600", debit: 0, credit: 11_900, taxCode: null },
    ]);
  });
});

describe("legacyCorrectionPosting", () => {
  const storno = computeInvoiceTotals([{ quantity: 1000, unitPrice: -100_000, taxRate: 1900 }]);

  it("Ist: hebt die Eröffnungsbuchung genau auf", () => {
    const opening = openingInvoicePosting(computeInvoiceTotals([{ quantity: 1000, unitPrice: 100_000, taxRate: 1900 }]), "SKR03", "ist");
    const lines = legacyCorrectionPosting(storno, "SKR03", "ist");
    expect(lines).toEqual([
      { account: "1400", debit: 0, credit: 119_000, taxCode: null },
      { account: "1766", debit: 19_000, credit: 0, taxCode: null },
      { account: "9000", debit: 100_000, credit: 0, taxCode: null },
    ]);
    const saldo = (account: string) =>
      [...opening, ...lines].filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);
    expect(["1400", "1766", "9000"].map(saldo)).toEqual([0, 0, 0]);
  });

  it("Soll: mindert die schon angemeldete Umsatzsteuer", () => {
    expect(legacyCorrectionPosting(storno, "SKR04", "soll")).toEqual([
      { account: "1200", debit: 0, credit: 119_000, taxCode: null },
      { account: "3806", debit: 19_000, credit: 0, taxCode: "USt19" },
      { account: "9000", debit: 100_000, credit: 0, taxCode: null },
    ]);
  });
});

describe("Kasse", () => {
  it("bar bezahlter Beleg geht gegen die Kasse", () => {
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 1_000, taxRate: 1900 }]);
    expect(documentPosting(totals, "buero", "SKR03", "kasse").at(-1)).toEqual({ account: "1000", debit: 0, credit: 1_190, taxCode: null });
    expect(documentPosting(totals, "buero", "SKR04", "kasse").at(-1)).toMatchObject({ account: "1600", credit: 1_190 });
  });

  it("Einlage, Entnahme und Geldtransit", () => {
    expect(cashPosting("privat", 5_000, "SKR03")).toEqual([
      { account: "1000", debit: 5_000, credit: 0, taxCode: null },
      { account: "1890", debit: 0, credit: 5_000, taxCode: null },
    ]);
    expect(cashPosting("privat", -2_000, "SKR03").map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1000", 0, 2_000],
      ["1800", 2_000, 0],
    ]);
    expect(cashPosting("geldtransit", 10_000, "SKR04").map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1600", 10_000, 0],
      ["1460", 0, 10_000],
    ]);
  });
});

describe("Rundung bei Storno", () => {
  const saldo = (...buchungen: { account: string; debit: number; credit: number }[][]) => {
    const sums = new Map<string, number>();
    for (const line of buchungen.flat()) sums.set(line.account, (sums.get(line.account) ?? 0) + line.debit - line.credit);
    return [...sums.values()].filter((v) => v !== 0);
  };

  it("Beleg mit Privatanteil und sein Storno heben sich exakt auf", () => {
    // 12,34 € netto, 25 % privat: 308,5 Cent und 58,5 Cent liegen genau auf der Hälfte
    const beleg = computeInvoiceTotals([{ quantity: 1000, unitPrice: 1_234, taxRate: 1900 }]);
    const storno = computeInvoiceTotals([{ quantity: 1000, unitPrice: -1_234, taxRate: 1900 }]);
    expect(saldo(documentPosting(beleg, "telefon", "SKR03", "bank", true, undefined, 25), documentPosting(storno, "telefon", "SKR03", "bank", true, undefined, 25))).toEqual([]);
  });

  it("Steueranteile einer Zahlung und ihrer Rückzahlung sind spiegelbildlich", () => {
    // Hälfte von 11,90 €: Anteile 50,5 / 9,5 / 35 Cent liegen auf der Hälfte
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 101, taxRate: 1900 }, { quantity: 1000, unitPrice: 1_000, taxRate: 700 }]);
    const negated = computeInvoiceTotals([{ quantity: 1000, unitPrice: -101, taxRate: 1900 }, { quantity: 1000, unitPrice: -1_000, taxRate: 700 }]);
    for (const paid of [1, 113, 595]) {
      const hin = paidTaxShares(totals, paid);
      const zurueck = paidTaxShares(negated, -paid);
      expect(zurueck.map((r) => [r.base, r.tax])).toEqual(hin.map((r) => [-r.base, -r.tax]));
    }
  });
});
