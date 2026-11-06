import { describe, expect, it } from "vitest";
import { paymentHistoryIssue, visiblePayment } from "./payment-history.ts";

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
});
