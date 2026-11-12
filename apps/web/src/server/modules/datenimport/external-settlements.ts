import { ACCOUNTS, kontoart, type Kontenrahmen } from "@haben/core";
import type { ExternalJournal } from "./external-schema.ts";
import { ExternalImportError } from "./external-validation.ts";

const saldo = (entry: ExternalJournal, account: string) => entry.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);
const success = (kr: Kontenrahmen, entry: ExternalJournal) => entry.lines.some((l) => l.debit !== l.credit && kontoart(kr, l.account) !== "bestand");
const invalid = (id: string): never => {
  throw new ExternalImportError(
    `Buchung ${id}: Zahlungsbezug ungültig. Eine ursprüngliche OP-Buchung derselben Quelle, passende Konten und Beträge sind erforderlich.`,
  );
};

/** Ein Zahlungsbezug gilt einer ursprünglichen Buchung, nicht einem anderen Ausgleich; geprüft unter der Importsperre. */
export function validateExternalSettlements(kr: Kontenrahmen, journals: ExternalJournal[]) {
  const byId = new Map(journals.map((e) => [e.externalId, e]));
  const days = new Map<string, { id: string; gross: number; amount: number }>();
  for (const payment of [...journals].sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId))) {
    if (!payment.settles) continue;
    const original = byId.get(payment.settles);
    if (!original || original.settles || original.externalId === payment.externalId || original.date > payment.date) return invalid(payment.externalId);
    const accounts = [ACCOUNTS[kr].forderungen, ACCOUNTS[kr].verbindlichkeiten];
    const open = accounts.filter((a) => original.lines.some((l) => l.account === a));
    if (open.length !== 1 || !success(kr, original) || success(kr, payment)) return invalid(payment.externalId);
    const account = open[0]!;
    if (payment.lines.some((l) => accounts.includes(l.account as never) && l.account !== account)) return invalid(payment.externalId);
    const gross = saldo(original, account);
    const amount = -saldo(payment, account);
    if (!gross || !amount) return invalid(payment.externalId);
    // Quellkennungen geben keine Reihenfolge innerhalb eines Tages vor, insbesondere bei Rückzahlungen.
    const key = JSON.stringify([payment.date, original.externalId]);
    const day = days.get(key) ?? { id: original.externalId, gross, amount: 0 };
    day.amount += amount;
    days.set(key, day);
  }
  const paid = new Map<string, number>();
  for (const day of days.values()) {
    const total = (paid.get(day.id) ?? 0) + day.amount;
    if ((total !== 0 && Math.sign(total) !== Math.sign(day.gross)) || Math.abs(total) > Math.abs(day.gross)) return invalid(day.id);
    paid.set(day.id, total);
  }
}
