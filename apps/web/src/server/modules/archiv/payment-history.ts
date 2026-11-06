import type { LegacyPayment } from "../../db/schema.ts";

type PaymentSource = {
  source: "lexoffice" | "sevdesk";
  gross: number;
  status: string;
  payment: LegacyPayment | null;
};

/** Auch Altimporte enthalten nur den Gesamtbetrag am letzten Zahldatum, keine belegte Einzelzahlung. */
export function paymentHistoryIssue(voucher: PaymentSource): string | null {
  if (voucher.source !== "sevdesk") return null;
  const payment = voucher.payment;
  const paid = payment && (Math.abs(payment.openAmount) !== Math.abs(voucher.gross) || payment.items.length > 0);
  return paid || voucher.status === "paid" || voucher.status === "partlyPaid"
    ? "sevDesk-Zahlungshistorie unvollständig: Einzelzahlungen sind nicht belegt; Monatswerte und Stand am Stichtag müssen geklärt werden"
    : null;
}

/** Keine Verdichtung aus einem Altimport als echte Zahlung ausgeben; gespeicherte Originaldaten bleiben unberührt. */
export function visiblePayment(voucher: PaymentSource): LegacyPayment | null {
  return voucher.payment && paymentHistoryIssue(voucher) ? { ...voucher.payment, paidDate: null, items: [] } : voucher.payment;
}
