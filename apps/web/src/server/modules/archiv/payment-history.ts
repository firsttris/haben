import { formatEuro } from "@haben/core";
import { lexDate } from "@haben/import";
import { sql, type SQL } from "drizzle-orm";
import type { LegacyPayment, LegacySource } from "../../db/schema.ts";
import { expenseCreditNote } from "./sevdesk-richtung.ts";

type PaymentSource = {
  source: LegacySource;
  gross: number;
  status: string;
  payment: LegacyPayment | null;
  /** `payDate` aus den sevDesk-Originaldaten (raw); fehlt es, gilt die Unklarheit unbegrenzt. */
  payDate?: string | null;
};

/**
 * Stornierte sevDesk-Rechnungen und ihre Stornorechnungen, je ID das Datum des Stornos. sevDesk führt beide als „bezahlt“
 * ohne Zahlung; erkennbar ist das Paar nur an invoiceType SR und origin (#472). Nur der volle Betrag, nur ohne Zahlung und
 * nur bei genau einer Stornorechnung zur Rechnung: Sonst erklärt der Storno den Zahlungsstand nicht. Unverbunden, damit Postgres sie je Abfrage einmal berechnet.
 */
const unpaid = (alias: string) => `coalesce(${alias}.raw->>'paidAmount', '') ~ '^0*([.,]0*)?$' and coalesce(${alias}.raw->>'payDate', '') = ''`;
/**
 * Die Stornorechnung darf ein payDate tragen: sevDesk markiert sie beim Stornieren teils als bezahlt, ohne dass Geld floss
 * (#472, Entscheidung im Issue). Dann zählt nur ein ausdrücklich genanntes paidAmount von 0. Ebenso legt sevDesk beim Stornieren
 * teils einen Eintrag in CheckAccountTransactionLog mit amountPaid 0 an; eine Zuordnung über 0 € ist keine Zahlung.
 */
const stornoUnpaid = (alias: string) => `(${unpaid(alias)} or ${alias}.raw->>'paidAmount' ~ '^0+([.,]0*)?$')`;
const STORNO_PAIRS = sql.raw(`(select coalesce(jsonb_object_agg(member.id, storno.date), '{}'::jsonb)
  from lexoffice_vouchers storno
  join lexoffice_vouchers original on original.lexoffice_id = 'invoice/' || (storno.raw->'origin'->>'id') and original.source = 'sevdesk'
  cross join lateral (values (storno.id::text), (original.id::text)) as member(id)
  where storno.type = 'creditnote' and storno.source = 'sevdesk' and upper(storno.raw->>'invoiceType') = 'SR'
    and storno.raw->'origin'->>'objectName' = 'Invoice' and storno.gross = -original.gross
    and ${stornoUnpaid("storno")} and ${unpaid("original")}
    and not exists (select 1 from lexoffice_vouchers other where other.id <> storno.id and other.source = 'sevdesk'
      and upper(other.raw->>'invoiceType') = 'SR' and other.raw->'origin'->>'id' = storno.raw->'origin'->>'id')
    and not exists (select 1 from legacy_voucher_payments paid where paid.voucher_id in (storno.id, original.id) and paid.amount <> 0))`);

/**
 * Zahlungsstand mit den belegten Einzelzahlungen aus legacy_voucher_payments statt der gespeicherten Verdichtung.
 * Die Archivkopie bleibt unverändert; ohne Einzelzahlungen gilt sie wie gespeichert. `alias` ist der Tabellenname
 * oder Alias von lexoffice_vouchers in der Abfrage.
 * Nur Zuordnungen, die sevDesk bis zum Abruf der Kopie angelegt hatte (`create` im CheckAccountTransactionLog): Die Kopie
 * zeigt den Stand von damals; eine spätere Zuordnung kann ihn nicht erklären, auch bei zufällig gleichem Betrag (Review #361).
 * Stornierte Rechnungen und ihr Storno sind ausgeglichen, ohne dass Geld floss.
 */
export function effectivePayment(alias: string): SQL<LegacyPayment | null> {
  const v = sql.raw(alias);
  const payment = sql`coalesce((
    select ${v}.payment || jsonb_build_object('status', 'cancelled', 'openAmount', 0, 'paidDate', null, 'items', '[]'::jsonb, 'history', 'storno', 'cancelledOn', pair.cancelled_on)
    from (select ${STORNO_PAIRS}->>(${v}.id::text) as cancelled_on) pair where pair.cancelled_on is not null and ${v}.payment is not null), (
    select jsonb_set(${v}.payment, '{items}', jsonb_agg(jsonb_build_object(
      'type', case when ${v}.source = 'import' then 'payment' else 'partPaymentFinancialTransaction' end, 'date', p.date::text, 'amount', p.amount, 'account', p.account_name)
      order by p.date, p.external_id)) || jsonb_build_object('history', case when ${v}.source = 'import' then 'import' else 'sevdesk' end)
    from legacy_voucher_payments p where p.voucher_id = ${v}.id and ${v}.payment is not null
      and case when p.raw->>'create' ~ '^\\d{4}-\\d{2}-\\d{2}T' then (p.raw->>'create')::timestamptz <= ${v}.created_at else true end
    having count(*) > 0), ${v}.payment)`;
  // Ausgabe-Gutschriften (Honorar, Provision) stehen zur Laufzeit mit positivem Brutto; der gespeicherte offene Betrag
  // trägt noch das Vorzeichen der negativen Einnahme
  return sql<LegacyPayment | null>`(select case when ${sql.raw(expenseCreditNote(alias))} and eff.p->>'openAmount' is not null
      then jsonb_set(eff.p, '{openAmount}', to_jsonb(-(eff.p->>'openAmount')::numeric)) else eff.p end
    from (select ${payment} as p) eff)`;
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
  if (voucher.source === "import") {
    const payment = voucher.payment;
    // Ein storniertes Original ist weder offen noch bezahlt; es bleibt im Archiv, wird aber kein offener Posten.
    if (voucher.status === "voided") return "Original storniert; keine offene Forderung oder Verbindlichkeit, nicht als offener Posten übernehmen.";
    if (voucher.status === "unknown") return "Übernommener Zahlungsstand ungeklärt; Stand am Stichtag und Zahlungszeitpunkte müssen geprüft werden.";
    if (payment?.history === "import") return historyIssue(voucher.gross, payment)?.replaceAll("sevDesk", "Import") ?? null;
    return (payment && Math.abs(payment.openAmount) !== Math.abs(voucher.gross)) || voucher.status === "paid" || voucher.status === "partlyPaid"
      ? "Übernommene Zahlungsdaten ungeklärt: Der Bezahlt-Status ist kein Nachweis von Betrag und Zahlungszeitpunkt."
      : null;
  }
  if (voucher.source !== "sevdesk") return null;
  const payment = voucher.payment;
  if (payment?.history === "storno") return null;
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
  if (voucher.source === "import")
    return voucher.payment?.status === "balanced" && !paymentHistoryIssue(voucher)
      ? (voucher.payment.items
          .map((p) => p.date)
          .sort()
          .at(-1) ?? null)
      : null;
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
