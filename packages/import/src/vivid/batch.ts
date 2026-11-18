import { germanDay } from "@haben/core";
import { IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement, type MovementKind } from "../importvertrag/index.ts";
import { normalizeIban, normalizeText, parseDotAmount } from "../text.ts";
import type { ParsedStatement, ParsedTransaction } from "../types.ts";
import type { VividAccount, VividTransaction } from "./client.ts";

/*
 * Abruf über die Vivid Business API als Lieferung des Importvertrags (#306, #1393). Kontokennung ist die `id` des Kontos
 * (API: „use it as your key“), Ereigniskennung die `id` des Umsatzes: Sie bleibt, wenn aus der Vormerkung die Buchung wird
 * (API: „A hold and its settlement are the same record“).
 *
 * Grenzen der API v1: Sie nennt keinen Buchungstag, nur `show_at` (Zeitpunkt aus Sicht der Firma, etwa die Autorisierung
 * der Karte), keinen Verwendungszweck und keine Gegenseite außer dem Händler bei Kartenzahlungen und keinen gebuchten
 * Saldo, nur den verfügbaren. Tag des Umsatzes ist deshalb der Tag von `show_at` in Deutschland, ohne ihn `created_at`;
 * Salden liefert die Lieferung keine.
 */

export const VIVID_PROVIDER = "vivid";

/** Arten der API in Klartext; unbekannte bleiben, wie Vivid sie nennt (Liste kann wachsen) */
const ARTEN: Record<string, string> = {
  card_payment: "Kartenzahlung",
  card_refund: "Kartenerstattung",
  atm: "Bargeldabhebung",
  transfer: "Überweisung",
  exchange: "Währungstausch",
  fee: "Gebühr",
  other: "Sonstiges",
};

const KIND: Record<string, MovementKind> = { card_refund: "refund", fee: "fee" };

/** IBAN eines Kontos, die für Zahlungen im Inland zuerst */
export function vividIban(account: VividAccount): string | undefined {
  const details = [...(account.account_details ?? [])].sort((a, b) => Number(b.type === "local") - Number(a.type === "local"));
  return details.map((d) => normalizeIban(d.iban ?? undefined)).find((iban) => iban !== undefined);
}

/** Tag des Umsatzes in Deutschland; undefined ohne gültigen Zeitpunkt */
export function vividTag(t: VividTransaction): string | undefined {
  const zeit = t.show_at ?? t.created_at;
  if (!zeit) return undefined;
  const date = new Date(zeit);
  return Number.isNaN(date.getTime()) ? undefined : germanDay(date);
}

/** Verwendungszweck aus dem, was die API nennt: Art, Karte, Ort und Betrag in der Währung der Zahlung */
function zweck(t: VividTransaction): string {
  const ort = [t.merchant?.city, t.merchant?.country].filter(Boolean).join(", ");
  const original = t.original_amount && t.original_currency ? `${t.original_amount} ${t.original_currency}` : "";
  const karte = t.card?.last_4 ? `Karte …${t.card.last_4}` : "";
  return normalizeText([ARTEN[t.type ?? ""] ?? t.type ?? "", karte, ort, original].filter(Boolean).join(", "));
}

/** Ein abgeschlossener Umsatz; null ohne gültigen Tag oder Betrag */
export function mapVividTransaction(t: VividTransaction, index: number): ParsedTransaction | null {
  const bookingDate = vividTag(t);
  const amount = parseDotAmount(t.amount);
  if (!bookingDate || amount === null) return null;
  const name = normalizeText(t.merchant?.name ?? "");
  return {
    bookingDate,
    amount,
    currency: t.currency || "EUR",
    counterpartyName: name,
    purpose: zweck(t),
    type: ARTEN[t.type ?? ""] ?? (t.type || undefined),
    bankReference: t.id,
    index,
  };
}

export interface VividAbrufInput {
  account: VividAccount;
  transactions: VividTransaction[];
  /** Erster Tag des Abrufs; frühere Umsätze decken Dateien oder ein anderer Abrufweg ab */
  dateFrom: string;
  dateTo: string;
  /** Zeitpunkt mit Offset */
  fetchedAt: string;
  fetchId: string;
}

type Unsupported = ImportBatch["unsupported"][number];

/** Bewegung aus einem abgeschlossenen Umsatz, sonst der Eintrag unter `unsupported`; null vor dem Fenster */
function einordnen(t: VividTransaction, input: VividAbrufInput): { movement: ImportMovement; tx: ParsedTransaction } | Unsupported | null {
  const tag = vividTag(t);
  // Vor dem Fenster: Diese Tage decken Dateien oder ein anderer Abrufweg ab; schon abgerufene erkennt Haben ohnehin an der id
  if (tag && tag < input.dateFrom) return null;
  const skip = (reason: string): Unsupported => ({ sourceEventId: t.id, ...(tag ? { bookingDate: tag } : {}), reason });
  // abgelehnt ist ein Endzustand: sichtbar, hält den Zeitraum aber nicht offen
  if (t.state === "declined") return { sourceEventId: t.id, reason: "Abgelehnt (declined); wird nie gebucht.", final: true };
  if (t.state === "pending") return skip("Vorgemerkt (pending); folgt, sobald Vivid ihn bucht.");
  if (t.state !== "completed") return skip(`Status ${t.state ?? "ohne Angabe"}.`);
  const tx = mapVividTransaction(t, 0);
  if (!tx) return skip("Ohne gültigen Zeitpunkt oder Betrag.");
  // Ein Tag nach dem Abruf (kurz nach Mitternacht) holt der nächste Abruf
  if (tx.bookingDate > input.dateTo) return skip(`Tag ${tx.bookingDate} nach dem abgerufenen Fenster bis ${input.dateTo}.`);
  const movement: ImportMovement = {
    sourceEventId: t.id,
    component: "main",
    kind: KIND[t.type ?? ""] ?? "payment",
    bookingDate: tx.bookingDate,
    ...(t.show_at ? { sourceTimestamp: t.show_at } : {}),
    amount: tx.amount,
    currency: tx.currency,
    // Fehlende Angaben bleiben leer (Vertrag), nicht als leerer Text
    ...(tx.counterpartyName ? { counterpartyName: tx.counterpartyName } : {}),
    purpose: tx.purpose,
    references: { providerReference: t.id, ...(t.type ? { eventCode: t.type } : {}) },
  };
  return { movement, tx };
}

/**
 * Lieferung für `storeBatch` und derselbe Abruf als Kontoauszug. Die API liefert die neuesten zuerst; der Auszug ist nach
 * Tag sortiert, bei gleichem Tag nach `created_at` und `id`, damit gleiche Umsätze bei jedem Abruf dieselbe laufende
 * Nummer bekommen.
 */
export function vividAbruf(input: VividAbrufInput): { batch: ImportBatch; statement: ParsedStatement } {
  const movements: ImportMovement[] = [];
  const unsupported: Unsupported[] = [];
  const gebucht: { tx: ParsedTransaction; t: VividTransaction }[] = [];
  const gesehen = new Set<string>();
  for (const t of input.transactions) {
    // Dieselbe id auf zwei Seiten (die Liste wurde zwischen zwei Seiten länger) ist ein Umsatz
    if (gesehen.has(t.id)) continue;
    gesehen.add(t.id);
    const r = einordnen(t, input);
    if (r === null) continue;
    if ("movement" in r) {
      movements.push(r.movement);
      gebucht.push({ tx: r.tx, t });
    } else unsupported.push(r);
  }
  const transactions = gebucht
    .sort(
      (a, b) => a.tx.bookingDate.localeCompare(b.tx.bookingDate) || (a.t.created_at ?? "").localeCompare(b.t.created_at ?? "") || a.t.id.localeCompare(b.t.id),
    )
    .map(({ tx }, index) => ({ ...tx, index }));
  const vorgemerkt = unsupported.filter((u) => u.reason.startsWith("Vorgemerkt")).length;
  const statement: ParsedStatement = {
    format: "vivid",
    accountIban: vividIban(input.account),
    accountName: normalizeText(input.account.name ?? "") || undefined,
    currency: input.account.currency || "EUR",
    periodFrom: input.dateFrom,
    periodTo: input.dateTo,
    transactions,
    warnings: vorgemerkt > 0 ? [`${vorgemerkt} vorgemerkte Umsätze folgen, sobald Vivid sie bucht.`] : [],
  };
  const batch: ImportBatch = {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: VIVID_PROVIDER,
    externalAccountId: input.account.id,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    coverage: { from: input.dateFrom, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements,
    // Die API nennt nur den verfügbaren Saldo, keinen gebuchten mit Stichtag
    balances: [],
    unsupported,
  };
  return { batch, statement };
}

/** Ereignis zu einem Umsatz aus `vividAbruf`: `bankReference` ist die id des Umsatzes */
export const vividEventOf = (t: ParsedTransaction): string | undefined => t.bankReference;
