import { fastbillPreviousCalls } from "./fastbill.ts";
import { fastbillConnectionStatus } from "./fastbill-zugang.ts";

/**
 * Anfragen an FastBill in der letzten Stunde, wie Haben sie gezählt hat, für die Anzeige im Umzug. FastBill selbst nennt
 * den Rest nicht (keine Header dafür, geprüft November 2026); Aufrufe anderer Programme mit demselben Schlüssel fehlen.
 * freeAt: wann der Client wieder anfragen darf, wie dort (packages/import/src/fastbill/client.ts) die Anfrage an Stelle
 * länge − Grenze plus eine Stunde; auch über der Grenze, etwa nach einem kleineren Tarif.
 */
export async function fastbillUsage(now = Date.now()): Promise<{ used: number; freeAt: string | null }> {
  const calls = (await fastbillPreviousCalls()).filter((t) => t > now - 3_600_000);
  const limit = (await fastbillConnectionStatus())?.callsPerHour ?? calls.length;
  const over = calls.length - limit;
  return { used: calls.length, freeAt: calls.length > 0 && over >= 0 ? new Date(calls[over]! + 3_600_000).toISOString() : null };
}
