import { fastbillPreviousCalls } from "./fastbill.ts";

/**
 * Anfragen an FastBill in der letzten Stunde, wie Haben sie gezählt hat, für die Anzeige im Umzug. FastBill selbst nennt
 * den Rest nicht (keine Header dafür, geprüft November 2026); Aufrufe anderer Programme mit demselben Schlüssel fehlen.
 * freeAt: wann die älteste dieser Anfragen aus der Stunde fällt.
 */
export async function fastbillUsage(now = Date.now()): Promise<{ used: number; freeAt: string | null }> {
  const calls = (await fastbillPreviousCalls()).filter((t) => t > now - 3_600_000);
  return { used: calls.length, freeAt: calls.length > 0 ? new Date(calls[0]! + 3_600_000).toISOString() : null };
}
