import { describe, expect, it } from "vitest";
import { computeInvoice } from "./invoice.ts";
import {
  discountedLineAmount,
  discountFromColumns,
  discountLabel,
  distribute,
  documentAllowances,
  documentDiscountProblem,
  lineDiscountAmount,
  lineDiscountProblem,
  parseDiscount,
  type Discount,
} from "./rabatt.ts";

const prozent = (value: number): Discount => ({ kind: "prozent", value });
const betrag = (value: number): Discount => ({ kind: "betrag", value });

describe("Rabatt eingeben", () => {
  it("liest Prozent und Betrag", () => {
    expect(parseDiscount("10 %")).toEqual(prozent(1000));
    expect(parseDiscount("2,5%")).toEqual(prozent(250));
    expect(parseDiscount("50,00")).toEqual(betrag(5000));
    expect(parseDiscount("1.250")).toEqual(betrag(125_000));
    expect(parseDiscount("")).toBeNull();
    expect(parseDiscount("  ")).toBeNull();
  });

  it("lehnt Unsinn, 0 und mehr als 100 % ab", () => {
    expect(parseDiscount("zehn")).toBe("ungültig");
    expect(parseDiscount("0 %")).toBe("ungültig");
    expect(parseDiscount("0,00")).toBe("ungültig");
    expect(parseDiscount("100,01 %")).toBe("ungültig");
    expect(parseDiscount("-5")).toBe("ungültig");
  });

  it("zeigt den Rabatt wie eingegeben", () => {
    expect(discountLabel(prozent(1000))).toBe("10 %");
    expect(discountLabel(betrag(5000))).toBe("50,00 €");
  });

  it("Spalten der Datenbank: höchstens eine gesetzt", () => {
    expect(discountFromColumns(null, null)).toBeNull();
    expect(discountFromColumns(1000, null)).toEqual(prozent(1000));
    expect(discountFromColumns(null, 5000)).toEqual(betrag(5000));
  });
});

describe("Verteilen mit Rundungsrest", () => {
  it("anteilig, Rest an den größten Anteil", () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distribute(1000, [7000, 3000])).toEqual([700, 300]);
    // 333,33 + 166,67 → 333 und 167: Summe stimmt exakt
    expect(distribute(500, [2, 1])).toEqual([333, 167]);
  });

  it("negiert exakt (Storno)", () => {
    expect(distribute(-100, [-1, -1, -1])).toEqual([-34, -33, -33]);
    expect(distribute(-500, [-2, -1])).toEqual([-333, -167]);
  });

  it("ohne Gewicht bleibt alles 0", () => {
    expect(distribute(0, [5, 5])).toEqual([0, 0]);
    expect(distribute(100, [0, 0])).toEqual([0, 0]);
  });
});

describe("Positionsrabatt", () => {
  it("Prozent kaufmännisch gerundet, Betrag wie eingegeben", () => {
    expect(lineDiscountAmount(9995, prozent(1000))).toBe(1000); // 999,5 → 1000
    expect(lineDiscountAmount(-9995, prozent(1000))).toBe(-1000);
    expect(lineDiscountAmount(10_000, betrag(2500))).toBe(2500);
    expect(discountedLineAmount({ quantity: 2000, unitPrice: 5000, discount: prozent(1000) })).toBe(9000);
    expect(discountedLineAmount({ quantity: 2000, unitPrice: 5000 })).toBe(10_000);
  });

  it("höchstens die Position, gleiches Vorzeichen", () => {
    expect(lineDiscountProblem({ quantity: 1000, unitPrice: 5000, discount: betrag(5000) })).toBeNull();
    expect(lineDiscountProblem({ quantity: 1000, unitPrice: 5000, discount: betrag(5001) })).toBe("Der Rabatt ist höher als die Position");
    expect(lineDiscountProblem({ quantity: 1000, unitPrice: -5000, discount: betrag(-1000) })).toBeNull();
    expect(lineDiscountProblem({ quantity: 1000, unitPrice: -5000, discount: betrag(1000) })).toBe("Der Rabatt ist höher als die Position");
  });

  it("netto: Zeilennetto nach Rabatt, Steuer auf die Summe", () => {
    const { totals, lineNets, lineAmounts } = computeInvoice([{ quantity: 10_000, unitPrice: 9500, taxRate: 1900, discount: prozent(1000) }], "netto");
    expect(lineAmounts).toEqual([85_500]);
    expect(lineNets).toEqual([85_500]);
    expect(totals).toMatchObject({ net: 85_500, tax: 16_245, gross: 101_745 });
  });

  it("brutto: Endpreis nach Rabatt, Steuer herausgerechnet", () => {
    const { totals, lineNets } = computeInvoice([{ quantity: 1000, unitPrice: 11_900, taxRate: 1900, discount: betrag(1900) }], "brutto");
    expect(totals).toMatchObject({ gross: 10_000, tax: 1597, net: 8403 });
    expect(lineNets).toEqual([8403]);
  });
});

describe("Gesamtrabatt je Steuersatz", () => {
  const mixed = [
    { quantity: 1000, unitPrice: 100_000, taxRate: 1900 as const },
    { quantity: 1000, unitPrice: 33_333, taxRate: 700 as const },
  ];

  it("Prozent gilt für jeden Satz gleich, Steuer je Satz nach Rabatt", () => {
    const { totals, allowances, lineNets } = computeInvoice(mixed, "netto", prozent(1000));
    expect(allowances).toEqual([
      { rate: 1900, basis: 100_000, amount: 10_000, net: 10_000 },
      { rate: 700, basis: 33_333, amount: 3333, net: 3333 },
    ]);
    expect(totals.taxes).toEqual([
      { rate: 1900, base: 90_000, tax: 17_100 },
      { rate: 700, base: 30_000, tax: 2100 },
    ]);
    // Die Positionen bleiben, wie sie sind; der Rabatt steht auf Belegebene (BG-20)
    expect(lineNets).toEqual([100_000, 33_333]);
  });

  it("fester Betrag im Verhältnis der Sätze, Rundungsrest an den größten", () => {
    const { allowances, totals } = computeInvoice(mixed, "netto", betrag(10_001));
    expect(allowances.map((a) => a.amount)).toEqual([7501, 2500]);
    expect(totals.net).toBe(133_333 - 10_001);
  });

  it("brutto: Rabatt vom Endpreis, Netto der Positionen und Abzug ergeben die Bemessungsgrundlage", () => {
    const { totals, allowances, lineNets } = computeInvoice([{ quantity: 1000, unitPrice: 11_900, taxRate: 1900 }], "brutto", prozent(1000));
    expect(totals).toMatchObject({ gross: 10_710, tax: 1710, net: 9000 });
    expect(allowances).toEqual([{ rate: 1900, basis: 11_900, amount: 1190, net: 1000 }]);
    expect(lineNets).toEqual([10_000]);
    expect(lineNets[0]! - allowances[0]!.net).toBe(totals.taxes[0]!.base);
  });

  it("Positionsrabatt zuerst, Gesamtrabatt danach auf die rabattierten Positionen", () => {
    const { totals } = computeInvoice([{ quantity: 1000, unitPrice: 10_000, taxRate: 1900, discount: prozent(1000) }], "netto", prozent(1000));
    expect(totals.net).toBe(8100);
  });

  it("Abzüge der Schlussrechnung bleiben vom Gesamtrabatt unberührt", () => {
    const { allowances, totals } = computeInvoice(
      [
        { quantity: 1000, unitPrice: 100_000, taxRate: 1900 },
        { quantity: 1000, unitPrice: -30_000, taxRate: 1900, deductionOf: "abschlag" },
      ],
      "netto",
      prozent(1000),
    );
    expect(allowances).toEqual([{ rate: 1900, basis: 100_000, amount: 10_000, net: 10_000 }]);
    expect(totals.net).toBe(60_000);
  });

  it("Storno: alles exakt negiert", () => {
    const original = computeInvoice(mixed, "brutto", betrag(10_001));
    const storno = computeInvoice(
      mixed.map((l) => ({ ...l, unitPrice: -l.unitPrice })),
      "brutto",
      betrag(-10_001),
    );
    expect(storno.totals.taxes).toEqual(original.totals.taxes.map((t) => ({ rate: t.rate, base: -t.base, tax: -t.tax })));
    expect(storno.lineNets).toEqual(original.lineNets.map((n) => -n));
  });

  it("ohne Rabatt unverändert", () => {
    expect(computeInvoice(mixed, "brutto").allowances).toEqual([]);
    expect(computeInvoice(mixed, "brutto", null).totals).toEqual(computeInvoice(mixed, "brutto").totals);
  });

  it("Rabatt höher als die Summe", () => {
    expect(documentDiscountProblem(mixed, betrag(133_334))).toBe("Der Gesamtrabatt ist höher als die Summe der Positionen");
    expect(documentDiscountProblem(mixed, betrag(133_333))).toBeNull();
    expect(documentDiscountProblem([{ quantity: 1000, unitPrice: -100, taxRate: 1900 }], betrag(50))).toBe(
      "Der Gesamtrabatt ist höher als die Summe der Positionen",
    );
  });
});

describe("Rabatt aus gespeicherten Beträgen (PDF und XML)", () => {
  it("leitet Abzug je Satz aus Zeilennetto und Steuerzeilen ab", () => {
    const lines = [
      { quantity: 1000, unitPrice: 100_000, taxRate: 1900 as const },
      { quantity: 1000, unitPrice: 33_333, taxRate: 700 as const, discount: prozent(500) },
    ];
    for (const priceMode of ["netto", "brutto"] as const) {
      const calc = computeInvoice(lines, priceMode, betrag(5000));
      const stored = lines.map((l, i) => ({ ...l, net: calc.lineNets[i]! }));
      expect(documentAllowances(stored, calc.totals, priceMode)).toEqual(calc.allowances);
    }
  });
});
