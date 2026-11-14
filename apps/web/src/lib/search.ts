/** Maskiert SQL-LIKE-Platzhalter, damit Nutzereingaben mit % oder _ buchstäblich gesucht werden */
export function likePattern(query: string): string {
  const escaped = query.trim().replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}

/**
 * Erkennt deutsche und punktgetrennte Euro-Eingaben für die Belegsuche („119“, „119,50“, „1.234,56 €“) und gibt Cent
 * zurück; Nicht-Beträge (wie Belegnummern „RE-2026“) liefern null.
 */
export function parseEuroSearchCents(query: string): number | null {
  const cleaned = query.trim().replace(/€/g, "").replace(/\s+/g, "");
  if (!cleaned || /[a-zA-Z]/.test(cleaned)) return null;
  let normalized = cleaned;
  if (/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+(,\d{1,2})$/.test(cleaned)) {
    normalized = cleaned.replace(",", ".");
  } else if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Math.abs(cents) <= 100_000_000_00 ? cents : null;
}
