import { IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement, type MovementKind } from "../importvertrag/types.ts";
import type { StripeBalanceTransaction } from "./client.ts";

/*
 * Ein Abruf der Stripe-Balance-Transactions als Lieferung des Importvertrags (#306). Ereigniskennung ist die ID der
 * Balance Transaction (`txn_…`), die Stripe je Bewegung des Guthabens vergibt
 * (https://docs.stripe.com/api/balance_transactions/object). `amount` ist der Bruttobetrag, `fee` die einbehaltene
 * Gebühr (positiv) und `net` = `amount − fee`. Hauptbetrag und Gebühr sind deshalb zwei Komponenten desselben
 * Ereignisses; ein Netto-Umsatz käme nicht dazu, er zählte doppelt.
 *
 * `status` (`available` oder `pending`) nennt nur, ob das Guthaben schon verfügbar ist, nicht, ob die Bewegung gebucht
 * ist: Auch `pending` ist eine feststehende Bewegung des Stripe-Guthabens, anders als eine Autorisierung. Der Adapter
 * verwirft deshalb nichts nach dem Status. Als Buchungstag gilt der Tag von `created` in UTC, wie in der Spalte
 * „Created (UTC)“ des CSV-Exports „Balance history“ (`parseStripe`); so landet dieselbe Bewegung aus Datei und API am
 * selben Tag.
 *
 * Kategorie nach `reporting_category`, das für die Buchhaltung gedacht ist und `type` feiner aufteilt
 * (https://docs.stripe.com/reports/reporting-categories). Was hier nicht aufgeführt ist (Transfers, Aufladungen,
 * Marktplatz- und Reservebewegungen), bleibt unter `unsupported` sichtbar und hält den Zeitraum offen, statt geraten zu
 * werden.
 */

export interface StripeBatchInput {
  /** Kontokennung der Quellenbindung: die Stripe-Konto-ID (`acct_…`) */
  externalAccountId: string;
  transactions: StripeBalanceTransaction[];
  /** Abgerufenes Fenster, YYYY-MM-DD (UTC) */
  dateFrom: string;
  dateTo: string;
  /** Zeitpunkt des Abrufs mit Offset; sein Tag darf nicht vor `dateTo` liegen */
  fetchedAt: string;
  /** Kennung dieses Abrufs; der Client holt alle Seiten selbst, die Lieferung hat deshalb genau einen Teil */
  fetchId: string;
}

/** Teil des Grunds für eine Bewegung, die Haben nicht einordnet, zum Zählen in der Meldung des Abrufs */
export const STRIPE_NICHT_UNTERSTUETZT = "Kategorie nicht unterstützt";

const KINDS: Record<string, MovementKind> = {
  charge: "payment",
  payment: "payment",
  refund: "refund",
  payment_refund: "refund",
  dispute: "chargeback",
  dispute_reversal: "adjustment",
  refund_failure: "adjustment",
  payout: "payout",
  payout_reversal: "adjustment",
  fee: "fee",
  stripe_fee: "fee",
  adjustment: "adjustment",
  other_adjustment: "adjustment",
};

/** Bei diesen Arten steht Stripe selbst auf der Gegenseite */
const STRIPE_IST_GEGENPARTEI = new Set<MovementKind>(["payout", "fee"]);

const RELATED = new Set<MovementKind>(["refund", "chargeback", "adjustment"]);

const day = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** Bewegungen (Hauptbetrag, ggf. Gebühr) einer Balance Transaction, sonst der Grund, warum sie keine ist */
function movements(t: StripeBalanceTransaction): ImportMovement[] | string {
  const category = t.reporting_category ?? t.type;
  const kind = KINDS[category];
  if (!kind) return `${STRIPE_NICHT_UNTERSTUETZT}: ${category}.`;
  if (t.amount - t.fee !== t.net) return `Netto ${t.net} passt nicht zu Betrag ${t.amount} und Gebühr ${t.fee}.`;
  const currency = t.currency.toUpperCase();
  const base = {
    sourceEventId: t.id,
    kind,
    bookingDate: day(t.created),
    sourceTimestamp: new Date(t.created * 1000).toISOString(),
    currency,
  };
  const references = {
    providerReference: t.id,
    eventCode: category,
    ...(kind === "payout" && t.source?.startsWith("po_") ? { payoutId: t.source } : {}),
    // Erstattung, Streit und deren Aufhebung nennen die Zahlung, auf die sie sich beziehen
    ...(RELATED.has(kind) && t.relatedTransactionId ? { relatedEventId: t.relatedTransactionId } : {}),
  };
  const stripe = STRIPE_IST_GEGENPARTEI.has(kind);
  // Zahlung, Erstattung, Streit: der Kunde aus dem Charge; bei Auszahlung und Gebühr ist Stripe die Gegenseite
  const customer = stripe ? undefined : t.customerName;
  const purpose = [t.description?.trim() || t.chargeDescription || category, t.invoice].filter(Boolean).join(" · ");
  const list: ImportMovement[] = [];
  // Eine Bewegung über 0 gibt es nicht; eine reine Gebühr (Betrag 0) bleibt als Gebührenkomponente
  if (t.amount !== 0) {
    list.push({
      ...base,
      component: "main",
      amount: t.amount,
      ...(stripe ? { counterpartyName: "Stripe" } : customer ? { counterpartyName: customer } : {}),
      purpose,
      references,
    });
  }
  if (t.fee !== 0) {
    list.push({ ...base, component: "fee", amount: -t.fee, counterpartyName: "Stripe", purpose: `Gebühr zu ${t.id}`, references });
  }
  return list;
}

/**
 * Lieferung für `validateBatch`. Ein Saldo nennt die Lieferung nicht: Die Balance Transactions tragen keinen
 * Kontostand, und der aktuelle Stand von `/v1/balance` hätte keinen Stichtag im Fenster.
 */
export function stripeBatch(input: StripeBatchInput): ImportBatch {
  const list: ImportMovement[] = [];
  const unsupported: ImportBatch["unsupported"] = [];
  for (const t of input.transactions) {
    const m = movements(t);
    if (typeof m === "string") unsupported.push({ sourceEventId: t.id, reason: m });
    else list.push(...m);
  }
  return {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: "stripe",
    externalAccountId: input.externalAccountId,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    coverage: { from: input.dateFrom, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements: list,
    balances: [],
    unsupported,
  };
}
