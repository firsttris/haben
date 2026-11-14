import { parseEuro } from "@haben/core";

const PG_INT4_MAX = 2_147_483_647;

/** Maskiert SQL-LIKE-Platzhalter, damit Nutzereingaben mit % oder _ buchstäblich gesucht werden */
export function likePattern(query: string): string {
  const escaped = query.trim().replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}

/**
 * Erkennt deutsche und punktgetrennte Euro-Eingaben für die Belegsuche („119“, „119,50“, „1.234,56 €“) und gibt Cent
 * im PostgreSQL-int4-Bereich zurück; Nicht-Beträge (wie „RE-2026“) und Übergroßes liefern null.
 */
export function parseEuroSearchCents(query: string): number | null {
  const cleaned = query.trim().replace(/\s|€/g, "");
  if (!cleaned) return null;
  // Einfaches Punkt-Dezimalformat („19.99“, „-42.5“) vor der Übergabe an parseEuro (Ganzzahl-Cent) angleichen
  const german = /^-?\d+\.\d{1,2}$/.test(cleaned) ? cleaned.replace(".", ",") : cleaned;
  const cents = parseEuro(german);
  if (cents === null || !Number.isSafeInteger(cents) || Math.abs(cents) > PG_INT4_MAX) return null;
  return cents;
}
