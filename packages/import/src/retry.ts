/** Wiederholbare HTTP-Status (Rate-Limit, Gateway) für die API-Clients */
export const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_BACKOFF_MS = 60_000;
const MAX_RETRY_AFTER_MS = 300_000;

/** Exponentielles Warten: 1 s, 2 s, 4 s … höchstens 60 s */
export function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Retry-After als Sekunden oder HTTP-Datum → Millisekunden (null, wenn unbrauchbar). */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.min(Math.round(Number(v) * 1000), MAX_RETRY_AFTER_MS);
  const date = Date.parse(v);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS);
}
