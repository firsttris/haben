import { stornoOpen } from "./lebenszyklus.ts";
import type { Cents } from "./money.ts";

/**
 * Rechnerischer Kunden-OPOS-Saldo nach dem ganzen Stornovorgang, einschließlich der Korrekturstornos.
 * Die Zielposten schließen; ihre neuen Stornos bleiben nach derselben OPOS-Regel offen wie in invoiceOpen.
 * Kein Zahlungsausgleich: Eine Aufrechnung verlangt Voraussetzungen und Erklärung (§§ 387, 388 BGB,
 * https://www.gesetze-im-internet.de/bgb/__387.html und https://www.gesetze-im-internet.de/bgb/__388.html).
 */
export function cancellationCustomerBalance(
  rows: readonly { id: string; contactId: string | null; paid: Cents; open: Cents }[],
  contactId: string | null,
  cancelledIds: readonly string[],
): Cents | undefined {
  if (!contactId || cancelledIds.length === 0) return undefined;
  const customer = rows.filter((i) => i.contactId === contactId);
  const cancelled = new Set(cancelledIds);
  if (cancelledIds.some((id) => !customer.some((i) => i.id === id))) return undefined;
  return customer.reduce((balance, i) => balance + (cancelled.has(i.id) ? stornoOpen(i.paid, 0) : i.open), 0);
}
