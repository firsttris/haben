import { describe, expect, it } from "vitest";
import { computeInvoice, orderRateAmounts, planSchedule, type PaymentPlanRow } from "@haben/core";
import { buildConfirmationPdf, confirmationPdfData } from "./order.ts";
import { buildQuotePdf, quotePdfData, type QuoteDocument } from "./quote.ts";
import { grossPriceLines, sampleDocument } from "./samples.ts";

function sampleQuote(overrides: Partial<QuoteDocument> = {}): QuoteDocument {
  const { seller, buyer, lines, totals } = sampleDocument();
  return { number: "AN-2026-007", issueDate: "2026-10-01", validUntil: "2026-10-31", seller, buyer, lines, totals, ...overrides };
}

describe("Angebot", () => {
  it("erfindet bei einem übernommenen Angebot ohne bekannte Frist kein Gültigkeitsdatum", () => {
    const data = quotePdfData(sampleQuote({ validUntil: null }));
    expect(data.meta.some((row) => row.label === "Gültig bis")).toBe(false);
    expect(data.payment).toBe("");
  });
  it("hat Titel, Gültigkeit und keine Zahlungsaufforderung", () => {
    const data = quotePdfData(sampleQuote({ serviceFrom: "2026-11-01", serviceTo: "2026-11-30" }));
    expect(data.title).toBe("Angebot");
    expect(data.meta).toEqual([
      { label: "Angebotsnummer", value: "AN-2026-007" },
      { label: "Angebotsdatum", value: "01.10.2026" },
      { label: "Gültig bis", value: "31.10.2026" },
      { label: "Leistungszeitraum", value: "01.11.2026 – 30.11.2026" },
      { label: "Kundennummer", value: "K-1007" },
    ]);
    expect(data.totals.gross.label).toBe("Angebotssumme");
    expect(data.payment).toBe("Dieses Angebot gilt bis zum 31.10.2026. Wir freuen uns auf Ihren Auftrag.");
    expect(data.taxNote).toBeNull();
  });

  it("zeigt Bruttopreise mit „darin enthalten“", () => {
    const { lines, totals } = sampleDocument({ lines: grossPriceLines, priceMode: "brutto" });
    const data = quotePdfData(sampleQuote({ lines, totals, priceMode: "brutto" }));
    expect(data.totals.gross).toEqual({ label: "Angebotssumme (inkl. USt)", value: "447,17\u00a0€" });
    expect(data.totals.included?.rows).toHaveLength(4);
    expect(data.labels.columns.net).toBe("Brutto");
  });

  it("zeigt bei Kleinunternehmern den Hinweis statt der Steuer", () => {
    const data = quotePdfData(sampleQuote({ taxTreatment: "kleinunternehmer" }));
    expect(data.totals.rows).toHaveLength(1);
    expect(data.taxNote).toMatch(/§ 19 UStG/);
  });

  it("zeigt den Text zur Position unter der Bezeichnung", () => {
    const { lines } = sampleDocument();
    const data = quotePdfData(sampleQuote({ lines: [{ ...lines[0]!, detail: "Agenda nach Abstimmung\nzwei Tage vor Ort" }, ...lines.slice(1)] }));
    expect(data.lines[0]?.detail).toBe("Agenda nach Abstimmung\nzwei Tage vor Ort");
    expect(data.lines.slice(1).every((l) => l.detail === null)).toBe(true);
  });

  it("erzeugt ein PDF", () => {
    const pdf = buildQuotePdf(sampleQuote());
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("kennzeichnet optionale und alternative Positionen, die Summe zählt nur die übrigen", () => {
    const { lines, totals } = sampleDocument();
    const data = quotePdfData(
      sampleQuote({
        lines: [lines[0]!, { ...lines[1]!, position: 2, kind: "alternative", alternativeTo: 1 }, { ...lines[1]!, position: 3, kind: "optional" }],
        totals: computeInvoice([lines[0]!], "netto").totals,
      }),
    );
    expect(data.lines.map((l) => ("tag" in l ? l.tag : null))).toEqual([
      null,
      "Alternative zu Pos. 1, nicht in der Angebotssumme",
      "Optional, nicht in der Angebotssumme",
    ]);
    expect(data.totals.rows[0]).toEqual({ label: "Summe netto", value: "14.440,00\u00a0€" });
    expect(totals.net).not.toBe(1_444_000);
  });

  it("Gesamtrabatt nur aus den Positionen, die zählen", () => {
    const { lines } = sampleDocument();
    const counted = [lines[0]!];
    const calc = computeInvoice(counted, "netto", { kind: "prozent", value: 1000 });
    const data = quotePdfData(
      sampleQuote({
        lines: [
          { ...lines[0]!, net: calc.lineNets[0]! },
          { ...lines[1]!, kind: "optional" },
        ],
        totals: calc.totals,
        discount: { kind: "prozent", value: 1000 },
      }),
    );
    expect(data.totals.rows.slice(0, 3)).toEqual([
      { label: "Zwischensumme", value: "14.440,00\u00a0€" },
      { label: "Gesamtrabatt 10\u00a0%", value: "\u22121.444,00\u00a0€" },
      { label: "Summe netto", value: "12.996,00\u00a0€" },
    ]);
  });

  it("Zahlungsplan mit Anteil, Fälligkeit und Betrag netto und brutto", () => {
    const { totals } = sampleDocument();
    const rows: PaymentPlanRow[] = [
      { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
      { label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" },
    ];
    const paymentPlan = planSchedule(rows, orderRateAmounts(totals, "netto"), "netto");
    const quote = sampleQuote({ paymentPlan });
    expect(quotePdfData(quote).plan).toEqual({
      title: "Zahlungsplan",
      columns: { label: "Zahlung", due: "Fällig bei", share: "Anteil", amount: "Betrag" },
      rows: [
        { label: "1. Anzahlung", due: "Auftragserteilung", share: "30\u00a0%", amount: "4.388,97\u00a0€ netto (5.222,87\u00a0€ brutto)" },
        { label: "2. Schlussrechnung", due: "Abnahme", share: "Rest", amount: "10.240,93\u00a0€ netto (12.186,71\u00a0€ brutto)" },
      ],
    });
    expect(quotePdfData(sampleQuote()).plan).toBeNull();
    // Auftragsbestätigung: nur mit Plan, wenn er übergeben wird
    expect(confirmationPdfData(quote, "2026-10-05").plan?.rows).toHaveLength(2);
    const pdf = buildConfirmationPdf(quote, "2026-10-05");
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("setzt Kennzeichen, Rabatt und Plan ins PDF", () => {
    const { lines, totals } = sampleDocument();
    const pdf = buildQuotePdf(
      sampleQuote({
        lines: [
          { ...lines[0]!, discount: { kind: "prozent", value: 1000 } },
          { ...lines[1]!, kind: "optional" },
        ],
        totals,
        discount: { kind: "betrag", value: 1000 },
        paymentPlan: planSchedule([{ label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" }], orderRateAmounts(totals, "netto"), "netto"),
      }),
    );
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
