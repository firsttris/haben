import { describe, expect, it } from "vitest";
import { paymentHistoryIssue, settledOn, unclearFrom, visiblePayment } from "./payment-history.ts";

const invoice = {
  source: "sevdesk" as const,
  gross: 11900,
  status: "paid",
  payment: { status: "balanced", openAmount: 0, paidDate: "2026-11-15", items: [{ type: "manualPayment", date: "2026-11-15", amount: 11900 }] },
};

describe("Zahlungshistorie aus sevDesk", () => {
  it("sperrt vollständig bezahlte Altimporte und verbirgt ihre fiktive Einzelzahlung ohne Mutation", () => {
    expect(paymentHistoryIssue(invoice)).toMatch(/Zahlungshistorie/);
    expect(visiblePayment(invoice)).toMatchObject({ openAmount: 0, paidDate: null, items: [] });
    expect(invoice.payment.items).toHaveLength(1);
  });

  it("erkennt Teilzahlungen auch ohne Einzelpositionen am Quellsaldo", () => {
    expect(paymentHistoryIssue({ ...invoice, status: "open", payment: { status: "partlyPaid", openAmount: 5950, paidDate: null, items: [] } })).toMatch(
      /Zahlungshistorie/,
    );
  });

  it("behält vollständig offene Vorgänge ohne Hinweise auf Zahlungen verwendbar", () => {
    expect(paymentHistoryIssue({ ...invoice, status: "open", payment: { status: "open", openAmount: 11900, paidDate: null, items: [] } })).toBeNull();
  });

  it("behandelt fehlende Zahlungsdaten bei Status bezahlt und negative Gutschriften ebenfalls als unklar", () => {
    expect(paymentHistoryIssue({ ...invoice, payment: null })).toMatch(/Zahlungshistorie/);
    expect(paymentHistoryIssue({ ...invoice, gross: -11900 })).toMatch(/Zahlungshistorie/);
  });

  it("erhält echte Einzelzahlungen aus Lexoffice unverändert", () => {
    const lexoffice = { ...invoice, source: "lexoffice" as const };
    expect(paymentHistoryIssue(lexoffice)).toBeNull();
    expect(visiblePayment(lexoffice)).toBe(invoice.payment);
  });

  it("begrenzt die Unklarheit eines ausgeglichenen Belegs auf die Zeit bis zum Ausgleich (payDate)", () => {
    const settled = { ...invoice, payDate: "2026-11-15T00:00:00+01:00" };
    expect(settledOn(settled)).toBe("2026-11-15");
    expect(unclearFrom(settled, "2026")).toBe(true);
    expect(unclearFrom(settled, "2026-11")).toBe(true);
    expect(unclearFrom(settled, "2026-12")).toBe(false);
    expect(unclearFrom(settled, "2027")).toBe(false);
    expect(visiblePayment(settled)).toMatchObject({ paidDate: "2026-11-15", items: [] });
  });

  it("lässt Teilzahlungen und Belege ohne payDate unbegrenzt unklar", () => {
    const part = { ...invoice, status: "open", payDate: "2026-11-15", payment: { status: "partlyPaid", openAmount: 5950, paidDate: null, items: [] } };
    expect(settledOn(part)).toBeNull();
    expect(unclearFrom(part, "2030")).toBe(true);
    expect(unclearFrom(invoice, "2030")).toBe(true);
  });
});
