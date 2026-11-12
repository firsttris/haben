import { kontoart } from "./ledger.ts";
import { ACCOUNTS, type Kontenrahmen, type PostingLine } from "./posting.ts";

export interface ExternalSettlementJournal {
  externalId: string;
  date: string;
  lines: readonly Pick<PostingLine, "account" | "debit" | "credit">[];
  settles?: string;
}

const saldo = (entry: ExternalSettlementJournal, account: string) =>
  entry.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);
const success = (kr: Kontenrahmen, entry: ExternalSettlementJournal) => entry.lines.some((l) => l.debit !== l.credit && kontoart(kr, l.account) !== "bestand");
const invalid = (id: string) =>
  `Buchung ${id}: Zahlungsbezug ungültig. Eine ursprüngliche OP-Buchung derselben Quelle, passende Konten und Beträge sind erforderlich.`;

/** Ein Zahlungsbezug gilt einer ursprünglichen Buchung derselben Quelle, nicht einem anderen Ausgleich. */
export function externalSettlementProblem(kr: Kontenrahmen, journals: readonly ExternalSettlementJournal[]): string | null {
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
  return null;
}
