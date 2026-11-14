import { parseEuro } from "./money.ts";

/**
 * Erkennt deutsche und punktgetrennte Euro-Eingaben fÃ¼r die Belegsuche (â€ž119â€œ, â€ž119,50â€œ, â€ž1.234,56 â‚¬â€œ) und gibt Cent
 * im PostgreSQL-int4-Bereich zurÃ¼ck; Nicht-BetrÃ¤ge (wie â€žRE-2026â€œ) und ÃœbergroÃŸes liefern null.
 */
export function parseEuroSearchCents(query: string): number | null {
  const cleaned = query.trim().replace(/\s|â‚¬/g, "");
  if (!cleaned) return null;
  // Einfaches Punkt-Dezimalformat (â€ž19.99â€œ, â€ž-42.5â€œ) vor der Ãœbergabe an parseEuro (Ganzzahl-Cent) angleichen
  const german = /^-?\d+\.\d{1,2}$/.test(cleaned) ? cleaned.replace(".", ",") : cleaned;
  const cents = parseEuro(german);
  if (cents === null || !Number.isSafeInteger(cents) || cents < -2_147_483_648 || cents > 2_147_483_647) return null;
  return cents;
}
