import { lexDate } from "@haben/import";
import type { LegacyPayment } from "../../db/schema.ts";

type PaymentSource = {
  source: "lexoffice" | "sevdesk";
  gross: number;
  status: string;
  payment: LegacyPayment | null;
  /** `payDate` aus den sevDesk-Originaldaten (raw); fehlt es, gilt die Unklarheit unbegrenzt. */
  payDate?: string | null;
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

/**
 * Tag des vollständigen Ausgleichs eines sevDesk-Belegs. Laut sevDesk-OpenAPI ist `payDate` „the date the end-customer
 * has paid the invoice“ (https://api.sevdesk.de/openapi.yaml); nach dem Ausgleich liegt keine Zahlung mehr. Aus den
 * Originaldaten, nicht aus `payment.paidDate`: Altimporte setzten dort ohne payDate ersatzweise das Belegdatum.
 */
export function settledOn(voucher: PaymentSource): string | null {
  if (voucher.source !== "sevdesk" || voucher.payment?.status !== "balanced") return null;
  return lexDate(voucher.payDate);
}

/**
 * Kann ein Beleg mit unklarer Zahlungshistorie eine Zahlung ab `from` (JJJJ, JJJJ-MM oder JJJJ-MM-TT) haben?
 * Ein ausgeglichener Beleg nur bis zu seinem Ausgleich; ohne Ausgleichsdatum immer.
 */
export function unclearFrom(voucher: PaymentSource, from: string): boolean {
  if (!paymentHistoryIssue(voucher)) return false;
  const settled = settledOn(voucher);
  return settled === null || settled.slice(0, from.length) >= from;
}

/** Keine Verdichtung aus einem Altimport als echte Zahlung ausgeben; gespeicherte Originaldaten bleiben unberührt. */
export function visiblePayment(voucher: PaymentSource): LegacyPayment | null {
  return voucher.payment && paymentHistoryIssue(voucher) ? { ...voucher.payment, paidDate: settledOn(voucher), items: [] } : voucher.payment;
}
