import { advanceReceivablesAt } from "../rechnungen/index.ts";
import type { OpenPosition } from "./reports.ts";

/** Die vorhandenen OPOS-Karten verwenden dieselbe Stichtagsgrenze wie Abgleich und Restlaufzeiten. */
export async function advanceOpenPositions(today: string) {
  const stand = await advanceReceivablesAt(today);
  const positions = stand.positions
    .map(
      (p): OpenPosition => ({
        id: p.id,
        number: p.number,
        party: p.party,
        date: p.date,
        dueDate: p.dueDate,
        gross: p.gross,
        open: p.open,
        daysOverdue: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.dueDate}T00:00:00Z`)) / 86_400_000),
        balanceKind: p.kind,
      }),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  return {
    invoiceIds: stand.invoiceIds,
    receivables: positions.filter((p) => p.balanceKind === "receivable"),
    unbilledReceivables: positions.filter((p) => p.balanceKind === "unbilled"),
    unbilledReceivablesTotal: stand.unbilled,
    advanceRequests: positions.filter((p) => p.balanceKind === "request"),
    advanceRequestsTotal: stand.requests,
    advanceRefunds: positions.filter((p) => p.balanceKind === "refund"),
    advanceRefundsTotal: positions.filter((p) => p.balanceKind === "refund").reduce((sum, p) => sum + p.open, 0),
  };
}
