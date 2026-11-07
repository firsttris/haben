import { formatEuro } from "@haben/core";
import { lexDate } from "@haben/import";
import { sql, type SQL } from "drizzle-orm";
import type { LegacyPayment } from "../../db/schema.ts";

type PaymentSource = {
  source: "lexoffice" | "sevdesk";
  gross: number;
  status: string;
  payment: LegacyPayment | null;
  /** `payDate` aus den sevDesk-Originaldaten (raw); fehlt es, gilt die Unklarheit unbegrenzt. */
  payDate?: string | null;
};

/**
 * Zahlungsstand mit den belegten Einzelzahlungen aus legacy_voucher_payments statt der gespeicherten Verdichtung.
 * Die Archivkopie bleibt unverändert; ohne Einzelzahlungen gilt sie wie gespeichert. `alias` ist der Tabellenname
 * oder Alias von lexoffice_vouchers in der Abfrage.
 * Nur Zuordnungen, die sevDesk bis zum Abruf der Kopie angelegt hatte (`create` im CheckAccountTransactionLog): Die Kopie
 * zeigt den Stand von damals; eine spätere Zuordnung kann ihn nicht erklären, auch bei zufällig gleichem Betrag (Review #361).
 */
export function effectivePayment(alias: string): SQL<LegacyPayment | null> {
  const v = sql.raw(alias);
  return sql<LegacyPayment | null>`coalesce((
    select jsonb_set(${v}.payment, '{items}', jsonb_agg(jsonb_build_object(
      'type', 'partPaymentFinancialTransaction', 'date', p.date::text, 'amount', p.amount, 'account', p.account_name)
      order by p.date, p.external_id)) || '{"history":"sevdesk"}'::jsonb
    from legacy_voucher_payments p where p.voucher_id = ${v}.id and ${v}.payment is not null
      and case when p.raw->>'create' ~ '^\\d{4}-\\d{2}-\\d{2}T' then (p.raw->>'create')::timestamptz <= ${v}.created_at else true end
    having count(*) > 0), ${v}.payment)`;
}

/** Belegte Einzelzahlungen erklären den Zahlungsstand nur, wenn sie in eine Richtung gehen und genau aufgehen. */
function historyIssue(gross: number, payment: LegacyPayment): string | null {
  const signs = new Set(payment.items.map((i) => Math.sign(i.amount)));
  if (signs.size > 1)
    return "sevDesk-Zahlungshistorie unvollständig: Die Einzelzahlungen enthalten Zahlung und Rückbuchung; Monatswerte und Stand am Stichtag müssen geklärt werden";
  const sum = payment.items.reduce((s, i) => s + Math.abs(i.amount), 0);
  const paid = Math.abs(gross) - Math.abs(payment.openAmount);
  return sum === paid
    ? null
    : `sevDesk-Zahlungshistorie unvollständig: Belegte Einzelzahlungen ergeben ${formatEuro(sum)} von ${formatEuro(paid)} Zahlungsstand; Monatswerte und Stand am Stichtag müssen geklärt werden`;
}

/** Ohne belegte Einzelzahlungen enthalten auch Altimporte nur den Gesamtbetrag am letzten Zahldatum. */
export function paymentHistoryIssue(voucher: PaymentSource): string | null {
  if (voucher.source !== "sevdesk") return null;
  const payment = voucher.payment;
  if (payment?.history === "sevdesk") return historyIssue(voucher.gross, payment);
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
