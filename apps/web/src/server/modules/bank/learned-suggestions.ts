// Vorschläge ohne Rechnung aus früheren Zuordnungen derselben Gegenpartei

import { aufRechtsformAngeboten, learnedDirectBooking, type DirectSuggestion, type LearnedBooking, type DirektKategorie } from "@haben/core";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { kleinunternehmerHistory, lastDayOfMonth, loadCompany } from "../stammdaten/index.ts";

type History = Map<string, { kinds: { value: LearnedBooking; count: number; last: string }[]; total: number }>;

/**
 * Frühere Zuordnungen je Gegenpartei, Richtung und Art, ohne aufgehobene; bei „Direkt buchen“ auf eine Kategorie je
 * Kategorie und Steuersatz. Schlüssel ist „IBAN bzw. Name|Vorzeichen“ (siehe historyKey); total zählt die Umsätze, nicht
 * die Zuordnungen, damit ein aufgeteilter Umsatz einmal zählt.
 */
async function allocationHistory(by: "iban" | "name", keys: string[]): Promise<History> {
  const result: History = new Map();
  if (keys.length === 0) return result;
  const key = by === "iban" ? sql`upper(replace(t.counterparty_iban, ' ', ''))` : sql`lower(btrim(t.counterparty_name))`;
  // Eine Art zählt nur mit dem Vorzeichen des Umsatzes: Die von einer Auszahlung abgezogene Gebühr (Teil mit umgekehrtem
  // Vorzeichen) macht aus der Auszahlung keinen Eingang „Gebühren“. total zählt alle Umsätze der Gegenpartei in der Richtung.
  const rows = await db.execute<{
    key: string;
    kind: string;
    category: string | null;
    tax_rate: number | null;
    count: string;
    last: string;
    total: string;
  }>(sql`
    with h as (
      select ${key} || '|' || sign(t.amount)::int as key, a.kind, a.category, a.tax_rate, t.id, t.booking_date,
             sign(a.amount) = sign(t.amount) as same
        from allocations a join bank_transactions t on t.id = a.transaction_id
       where a.reverses_id is null
         and not exists (select 1 from allocations r where r.reverses_id = a.id)
         and ${key} in ${keys}
    ),
    totals as (select key, count(distinct id) as total from h group by key)
    select h.key, h.kind, h.category, h.tax_rate, count(distinct h.id) as count, max(h.booking_date)::text as last, totals.total
      from h join totals on totals.key = h.key
     where h.same
     group by h.key, h.kind, h.category, h.tax_rate, totals.total`);
  for (const r of rows) {
    const entry = result.get(r.key) ?? { kinds: [], total: Number(r.total) };
    const kategorie = r.category !== null && r.tax_rate !== null ? { kategorie: r.category as DirektKategorie, steuersatz: r.tax_rate } : undefined;
    entry.kinds.push({ value: kategorie ? { kind: r.kind, kategorie } : { kind: r.kind }, count: Number(r.count), last: r.last });
    result.set(r.key, entry);
  }
  return result;
}

/** Schlüssel der Historie: Gegenpartei und Richtung (1 Eingang, -1 Abbuchung) */
const historyKey = (key: string | null, amount: number) => (key ? `${key}|${Math.sign(amount)}` : "");

const ibanKey = (iban: string | null) => iban?.replace(/\s/g, "").toUpperCase() || null;
const nameKey = (name: string) => name.trim().toLowerCase() || null;

/**
 * Vorschläge ohne Rechnung aus früheren Zuordnungen derselben Gegenpartei, je Umsatz (siehe learnedDirectBooking):
 * zuerst über die Gegen-IBAN, ohne Treffer dort über den Namen. Zwei Abfragen für alle Umsätze zusammen, damit die
 * Umsatzliste nicht je Zeile fragt. Eine Kategorie nur, wenn sie am Tag des Umsatzes so buchbar ist: Den
 * Kleinunternehmer-Stand prüft die Buchung für den Monat der Zahlung (kategoriebuchung), der Vorschlag ebenso.
 */
export async function learnedDirectSuggestions(
  txs: { id: string; amount: number; bookingDate: string; counterpartyIban: string | null; counterpartyName: string }[],
): Promise<Map<string, DirectSuggestion>> {
  const result = new Map<string, DirectSuggestion>();
  if (txs.length === 0) return result;
  const kleinunternehmerAm = await kleinunternehmerHistory();
  // Eine Aufladung gibt es nur im Einzelunternehmen (#1356): ein Vorschlag aus früheren Buchungen entfällt dort
  const { rechtsform } = await loadCompany();
  const byIban = await allocationHistory("iban", [...new Set(txs.flatMap((t) => ibanKey(t.counterpartyIban) ?? []))]);
  const rest = txs.filter((t) => !byIban.has(historyKey(ibanKey(t.counterpartyIban), t.amount)));
  const byName = await allocationHistory("name", [...new Set(rest.flatMap((t) => nameKey(t.counterpartyName) ?? []))]);
  for (const t of txs) {
    const iban = byIban.get(historyKey(ibanKey(t.counterpartyIban), t.amount));
    const name = byName.get(historyKey(nameKey(t.counterpartyName), t.amount));
    const history = iban ? { ...iban, basis: "iban" as const } : name ? { ...name, basis: "name" as const } : null;
    const kleinunternehmer = kleinunternehmerAm(lastDayOfMonth(Number(t.bookingDate.slice(0, 4)), Number(t.bookingDate.slice(5, 7))));
    const suggestion = history ? learnedDirectBooking(t, history.kinds, history.total, history.basis, kleinunternehmer) : null;
    if (suggestion && aufRechtsformAngeboten(suggestion.kind, rechtsform)) result.set(t.id, suggestion);
  }
  return result;
}
