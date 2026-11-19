import type { ParsedStatement, ParsedTransaction, StatementFormat } from "../types.ts";
import type { AccountKind, ImportBatch, ImportMovement, MovementKind } from "./types.ts";

/*
 * Kontoauszug aus einer Lieferung des Importvertrags (#306, Schritt 4): Beim REST-Import kommt keine Datei, nur die
 * Lieferung. Haben baut daraus den Auszug fürs Importprotokoll und die Umsätze, nach den Regeln der Exporte der
 * Zahlungsdienstleister (psp.ts): je Bewegung ein Umsatz, die Gebühr als eigener Umsatz mit „Gebühr“ vorn im
 * Verwendungszweck (so erkennt sie der Abgleich), eine Auszahlung mit der Referenz „payout-<Auszahlung>|…“ (so verbindet
 * sie der Abgleich als Geldtransit mit dem Eingang auf der Bank). Bezug einer Erstattung und Bestellung kommen in den
 * Verwendungszweck. Gegenpartei und Text erfindet Haben nicht.
 */

/** Format im Importprotokoll; das eines Zahlungsdienstleisters passt nur in dessen Konto (PSP_FORMATS) */
export const IMPORT_CONTRACT_FORMATS = { bank: "importvertrag", psp: "importvertrag-psp" } as const satisfies Record<AccountKind, StatementFormat>;

/** Schlüssel, der Umsatz und Bewegung verbindet: das Ereignis, bei einer anderen Komponente als `main` mit ihr dahinter */
export const eventKeyOf = (m: Pick<ImportMovement, "sourceEventId" | "component">): string =>
  m.component === "main" ? m.sourceEventId : `${m.sourceEventId}#${m.component}`;

const KIND_LABEL: Record<MovementKind, string> = {
  payment: "Zahlung",
  refund: "Erstattung",
  chargeback: "Rückbelastung",
  payout: "Auszahlung",
  fee: "Gebühr",
  adjustment: "Korrektur",
};

const isFee = (m: ImportMovement) => m.component === "fee" || m.kind === "fee";

function purposeOf(m: ImportMovement): string {
  const r = m.references;
  const parts = [
    m.kind === "payout" ? `Auszahlung ${r.payoutId ?? m.sourceEventId}` : "",
    (m.kind === "refund" || m.kind === "chargeback") && r.relatedEventId ? `${KIND_LABEL[m.kind]} zu ${r.relatedEventId}` : "",
    r.orderId && !m.purpose.includes(r.orderId) ? `Bestellung ${r.orderId}` : "",
    m.purpose,
  ].filter(Boolean);
  const text = parts.length > 0 ? parts.join(" · ") : KIND_LABEL[m.kind];
  return isFee(m) && !text.startsWith("Gebühr ·") ? `Gebühr · ${text}` : text;
}

function transactionOf(m: ImportMovement, index: number): ParsedTransaction {
  const r = m.references;
  return {
    bookingDate: m.bookingDate,
    ...(m.valueDate ? { valueDate: m.valueDate } : {}),
    amount: m.amount,
    currency: m.currency,
    counterpartyName: m.counterpartyName ?? "",
    ...(m.counterpartyIban ? { counterpartyIban: m.counterpartyIban } : {}),
    purpose: purposeOf(m),
    type: isFee(m) ? "Gebühr" : KIND_LABEL[m.kind],
    bankReference: m.kind === "payout" ? `payout-${r.payoutId ?? m.sourceEventId}|${m.sourceEventId}` : (r.providerReference ?? eventKeyOf(m)),
    ...(r.endToEndId ? { endToEndId: r.endToEndId } : {}),
    index,
  };
}

/** Auszug und Zuordnung Umsatz → Bewegung (`eventOf` für `storeBatch`), in der Reihenfolge der Lieferung */
export function statementFromBatch(
  batch: ImportBatch,
  accountKind: AccountKind,
): { statement: ParsedStatement; eventOf: (t: ParsedTransaction) => string | undefined } {
  const keys = batch.movements.map(eventKeyOf);
  const balance = batch.balances
    .filter((b) => b.currency === "EUR")
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const statement: ParsedStatement = {
    format: IMPORT_CONTRACT_FORMATS[accountKind],
    currency: "EUR",
    periodFrom: batch.coverage.from,
    periodTo: batch.coverage.to,
    ...(balance ? { statedBalance: { date: balance.date, amount: balance.amount } } : {}),
    transactions: batch.movements.map(transactionOf),
    warnings: [],
  };
  return { statement, eventOf: (t) => keys[t.index] };
}
