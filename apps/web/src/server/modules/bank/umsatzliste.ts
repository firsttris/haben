import { asc, desc, sql, type SQL } from "drizzle-orm";
import * as schema from "../../db/schema.ts";

/**
 * Sortierung der Umsatzliste im Bankabgleich (#681). Datum, Gegenpartei und Betrag sortiert die Datenbank vor der
 * Grenze von 500 Umsätzen, damit bei großen Konten wirklich die größten Beträge oder die ältesten Umsätze oben stehen.
 * Den Status gibt es erst nach dem Laden (Vorschläge); er sortiert die geladenen Umsätze (nachStatusSortieren).
 */
export const UMSATZ_SORTIERFELDER = ["datum", "gegenpartei", "betrag", "status"] as const;
export const SORTIERRICHTUNGEN = ["auf", "ab"] as const;

export type UmsatzSortierung = { feld: (typeof UMSATZ_SORTIERFELDER)[number]; richtung: (typeof SORTIERRICHTUNGEN)[number] };

/** Neuester Umsatz oben, wie vor der Sortierung */
export const STANDARD_SORTIERUNG: UmsatzSortierung = { feld: "datum", richtung: "ab" };

const t = schema.bankTransactions;

/**
 * ORDER BY für listTransactions; bei gleichem Wert steht der neuere Umsatz oben. Kein Ordnen nach der id: Sie ist
 * zufällig, Umsätze aus demselben Import (gleiches Datum und created_at) stünden sonst in zufälliger Reihenfolge
 * statt wie bisher in der des Imports.
 */
export function umsatzReihenfolge({ feld, richtung }: UmsatzSortierung): SQL[] {
  const r = richtung === "auf" ? asc : desc;
  const neuesteZuerst = [desc(t.bookingDate), desc(t.createdAt)];
  if (feld === "betrag") return [r(t.amount), ...neuesteZuerst];
  // Ohne Namen ans Ende, in beiden Richtungen
  if (feld === "gegenpartei")
    return [sql`lower(nullif(trim(${t.counterpartyName}), '')) ${sql.raw(richtung === "auf" ? "asc" : "desc")} nulls last`, ...neuesteZuerst];
  // Status: die neuesten 500 laden, sortiert wird danach
  if (feld === "status") return neuesteZuerst;
  return [r(t.bookingDate), r(t.createdAt)];
}

/**
 * Wie dringend ein Hinweis in der Liste ist. Absteigend, also beim ersten Klick, steht oben, was zu tun ist:
 * Beleg fehlt, Vorschlag, offen, teilweise, zugeordnet, verrechnet. Aufsteigend umgekehrt.
 */
const DRINGLICHKEIT = { belegFehlt: 5, vorschlag: 4, offen: 3, teilweise: 2, zugeordnet: 1, verrechnet: 0 } as const;
export type UmsatzHinweis = keyof typeof DRINGLICHKEIT;

/** Sortiert die geladenen Umsätze nach Status; bei gleichem Status bleibt die Reihenfolge aus der Datenbank */
export function nachStatusSortieren<T extends { hint: UmsatzHinweis }>(umsaetze: T[], richtung: UmsatzSortierung["richtung"]): T[] {
  const faktor = richtung === "auf" ? 1 : -1;
  return umsaetze
    .map((umsatz, index) => ({ umsatz, index }))
    .sort((a, b) => (DRINGLICHKEIT[a.umsatz.hint] - DRINGLICHKEIT[b.umsatz.hint]) * faktor || a.index - b.index)
    .map(({ umsatz }) => umsatz);
}
