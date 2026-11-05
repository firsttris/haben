import { describe, expect, it } from "vitest";
import { computeInvoice } from "./invoice.ts";
import {
  DEFAULT_PLAN_TEMPLATES,
  orderRateAmounts,
  planProblem,
  planProgress,
  planRowStatus,
  planSchedule,
  splitPlanShare,
  type PaymentPlanRow,
} from "./zahlungsplan.ts";

const plan: PaymentPlanRow[] = [
  { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
  { label: "Abschlag", share: { kind: "prozent", value: 4000 }, due: "Lieferung" },
  { label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" },
];

describe("Zahlungsplan prüfen", () => {
  it("letzte Zeile ist der Rest, die Summe übersteigt den Angebotsbetrag nicht", () => {
    expect(planProblem(plan, 1_000_000)).toBeNull();
    expect(planProblem([plan[0]!, plan[1]!], 1_000_000)).toBe("Die letzte Zeile des Zahlungsplans ist der Rest (Schlussrechnung)");
    expect(planProblem([plan[2]!, plan[0]!, plan[2]!], 1_000_000)).toBe("Nur die letzte Zeile des Zahlungsplans ist der Rest");
    expect(
      planProblem(
        [
          { label: "Anzahlung", share: { kind: "prozent", value: 6000 }, due: "" },
          { label: "Abschlag", share: { kind: "betrag", value: 400_001 }, due: "" },
          plan[2]!,
        ],
        1_000_000,
      ),
    ).toBe("Der Zahlungsplan übersteigt den Angebotsbetrag (10.000,01\u00a0€ von 10.000,00\u00a0€)");
    expect(planProblem([{ label: "", share: { kind: "prozent", value: 1000 }, due: "" }, plan[2]!], 1_000_000)).toBe(
      "Zeile 1 des Zahlungsplans braucht eine Bezeichnung",
    );
  });

  it("ein leerer Plan ist kein Plan", () => {
    expect(planProblem([], 1_000_000)).toBeNull();
  });

  it("Vorlagen 30/40/30 und 50/50", () => {
    expect(DEFAULT_PLAN_TEMPLATES.map((t) => t.name)).toEqual(["30/40/30", "50/50"]);
    for (const t of DEFAULT_PLAN_TEMPLATES) expect(planProblem(t.rows, 100)).toBeNull();
  });
});

describe("Abschlag je Steuersatz aufteilen", () => {
  // Angebot mit 19 % und 7 %: 7.000,00 € und 3.000,00 € netto
  const totals = computeInvoice(
    [
      { quantity: 1000, unitPrice: 700_000, taxRate: 1900 },
      { quantity: 1000, unitPrice: 300_000, taxRate: 700 },
    ],
    "netto",
  ).totals;

  it("Prozent gilt für jeden Satz gleich", () => {
    expect(splitPlanShare({ kind: "prozent", value: 3333 }, orderRateAmounts(totals, "netto"))).toEqual([
      { rate: 1900, amount: 233_310 },
      { rate: 700, amount: 99_990 },
    ]);
  });

  it("fester Betrag im Verhältnis der Nettobeträge, Rundungsrest an den größten Satz", () => {
    expect(splitPlanShare({ kind: "betrag", value: 100_001 }, orderRateAmounts(totals, "netto"))).toEqual([
      { rate: 1900, amount: 70_001 },
      { rate: 700, amount: 30_000 },
    ]);
  });

  it("brutto: fester Betrag brutto, Verhältnis nach Netto", () => {
    const gross = computeInvoice(
      [
        { quantity: 1000, unitPrice: 833_000, taxRate: 1900 },
        { quantity: 1000, unitPrice: 321_000, taxRate: 700 },
      ],
      "brutto",
    ).totals;
    // Netto 7.000 € und 3.000 €
    expect(orderRateAmounts(gross, "brutto")).toEqual([
      { rate: 1900, amount: 833_000, net: 700_000 },
      { rate: 700, amount: 321_000, net: 300_000 },
    ]);
    expect(splitPlanShare({ kind: "betrag", value: 100_000 }, orderRateAmounts(gross, "brutto"))).toEqual([
      { rate: 1900, amount: 70_000 },
      { rate: 700, amount: 30_000 },
    ]);
  });

  it("Zeilen mit Netto, Steuer und Brutto; der Rest ergänzt je Satz auf den Angebotsbetrag", () => {
    const rows = planSchedule(plan, orderRateAmounts(totals, "netto"), "netto");
    expect(rows.map((r) => r.gross)).toEqual([346_200, 461_600, 346_200]);
    expect(rows.map((r) => r.net)).toEqual([300_000, 400_000, 300_000]);
    expect(rows[0]!.rates).toEqual([
      { rate: 1900, amount: 210_000, base: 210_000, tax: 39_900 },
      { rate: 700, amount: 90_000, base: 90_000, tax: 6300 },
    ]);
    const perRate = (rate: number) => rows.reduce((s, r) => s + r.rates.find((x) => x.rate === rate)!.amount, 0);
    expect(perRate(1900)).toBe(700_000);
    expect(perRate(700)).toBe(300_000);
  });
});

describe("Fortschritt und Status", () => {
  it("Abgerechnet X von Y, offen Z", () => {
    expect(planProgress(700_000, 1_000_000)).toEqual({ billed: 700_000, total: 1_000_000, open: 300_000, percent: 7000 });
    expect(planProgress(0, 0)).toEqual({ billed: 0, total: 0, open: 0, percent: 0 });
  });

  it("Status je Zeile aus den Rechnungen dazu, stornierte zählen nicht", () => {
    expect(planRowStatus([])).toBe("offen");
    expect(planRowStatus([{ status: "draft", cancelled: false, open: 0 }])).toBe("entwurf");
    expect(planRowStatus([{ status: "final", cancelled: false, open: 1000 }])).toBe("festgeschrieben");
    expect(planRowStatus([{ status: "final", cancelled: false, open: 0 }])).toBe("bezahlt");
    expect(planRowStatus([{ status: "final", cancelled: true, open: 0 }])).toBe("offen");
  });
});
