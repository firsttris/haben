import type { Cents } from "./money.ts";

/** Nur festgeschriebene Belege mit dem neuen Bilanzverfahrensmarker; Altbelege liefert der Aufrufer nicht hierher. */
export interface DeferredInvoice {
  id: string;
  correctsId: string | null;
  replacesInvoiceId: string | null;
  kind: "rechnung" | "korrektur" | "storno";
  variant: "abschlag" | "schluss" | null;
  advanceType: "anzahlung" | "teilleistung" | null;
  number: string;
  party: string;
  issueDate: string;
  dueDate: string;
  performanceDate: string;
  gross: Cents;
}

export interface DeferredSettlement {
  invoiceId: string;
  date: string;
  amount: Cents;
  /** Gespeicherter Nettoanteil; nicht aus einem Steuersatz neu runden. */
  net: Cents;
  kind: "payment" | "writeOff";
}

export interface DeferredDeduction {
  invoiceId: string;
  advanceId: string;
}

export interface AdvanceReceivablePosition {
  id: string;
  originId: string;
  number: string;
  party: string;
  date: string;
  dueDate: string;
  gross: Cents;
  open: Cents;
  kind: "request" | "receivable" | "unbilled" | "refund";
}

export interface AdvanceReceivables {
  positions: AdvanceReceivablePosition[];
  /** Herkunftsumfang des gesonderten Journalabgleichs, keine Vereinigung nach Betrag oder Kundenname. */
  invoiceIds: string[];
  receivables: Cents;
  requests: Cents;
  unbilled: Cents;
  netAdvances: Cents;
}

function origin(invoice: DeferredInvoice, byId: ReadonlyMap<string, DeferredInvoice>): DeferredInvoice {
  const seen = new Set<string>();
  let current = invoice;
  while (current.correctsId || current.replacesInvoiceId) {
    if (seen.has(current.id)) throw new RangeError("Die Rechnungskette ist nicht eindeutig.");
    seen.add(current.id);
    const parent = byId.get((current.correctsId ?? current.replacesInvoiceId)!);
    if (!parent) throw new RangeError("Der Ursprung der Rechnungskette fehlt.");
    current = parent;
  }
  return current;
}

function replacementDepth(invoice: DeferredInvoice, byId: ReadonlyMap<string, DeferredInvoice>): number {
  let depth = 0;
  let current = invoice;
  while (current.replacesInvoiceId) {
    current = byId.get(current.replacesInvoiceId)!;
    depth++;
  }
  return depth;
}

function paperAt(members: readonly DeferredInvoice[], cutoff: string, byId: ReadonlyMap<string, DeferredInvoice>) {
  return members
    .filter((i) => i.kind === "rechnung" && i.issueDate <= cutoff)
    .sort((a, b) => replacementDepth(a, byId) - replacementDepth(b, byId))
    .at(-1);
}

function position(
  original: DeferredInvoice,
  paper: DeferredInvoice | undefined,
  kind: AdvanceReceivablePosition["kind"],
  gross: Cents,
  open: Cents,
): AdvanceReceivablePosition {
  const source = paper ?? original;
  return {
    id: source.id,
    originId: original.id,
    number: source.number,
    party: source.party,
    date: paper ? paper.issueDate : original.performanceDate,
    dueDate: source.dueDate,
    gross,
    open,
    kind,
  };
}

function requestAt(original: DeferredInvoice, members: readonly DeferredInvoice[], settled: Cents, cutoff: string): AdvanceReceivablePosition | null {
  if (original.issueDate > cutoff) return null;
  const gross = original.gross + members.filter((i) => i.id !== original.id && i.issueDate <= cutoff).reduce((sum, i) => sum + i.gross, 0);
  const open = gross - settled;
  if (!open) return null;
  const cancellation = members.find((i) => i.kind === "storno" && i.correctsId === original.id && i.issueDate <= cutoff);
  return position(original, open < 0 ? (cancellation ?? original) : original, open < 0 ? "refund" : "request", open < 0 ? -original.gross : gross, open);
}

function claimAt(
  original: DeferredInvoice,
  members: readonly DeferredInvoice[],
  settled: Cents,
  performed: boolean,
  cutoff: string,
  byId: ReadonlyMap<string, DeferredInvoice>,
): AdvanceReceivablePosition | null {
  // Bei einer Anforderung bilden ihre Korrektur-/Stornozeilen den angeforderten Betrag. Ein Schluss-Papierstorno
  // hebt dagegen weder die bereits erbrachte Leistung noch eine vorherige echte Entgeltkorrektur auf.
  const corrections = members.filter((i) => i.id !== original.id && i.issueDate <= cutoff && (original.variant === "abschlag" || i.kind === "korrektur"));
  const gross = performed ? original.gross + corrections.reduce((sum, i) => sum + i.gross, 0) : 0;
  const open = gross - settled;
  if (!open) return null;
  const paper = paperAt(members, cutoff, byId);
  const cancelled = paper && members.some((i) => i.kind === "storno" && i.correctsId === paper.id && i.issueDate <= cutoff);
  const kind = performed && (!paper || cancelled) ? "unbilled" : "receivable";
  return position(original, paper, kind, gross, open);
}

/**
 * Stichtagsstand aus Belegen und datierten Erledigungen, ohne Journal: § 252 Abs. 1 Nr. 4/5 HGB.
 * Vor Leistung nur tatsächlich erhaltenes Netto als Anzahlungsverbindlichkeit, offene Anforderungen getrennt.
 * Rechnungsaustausch nimmt keine Leistung zurück; zukünftige Zahlungen und Papierbelege ziehen den Stand nicht vor.
 * Quellen: https://www.gesetze-im-internet.de/hgb/__252.html und bestätigter Ablauf in #750.
 */
export function advanceReceivables(
  invoices: readonly DeferredInvoice[],
  settlements: readonly DeferredSettlement[],
  deductions: readonly DeferredDeduction[],
  cutoff: string,
): AdvanceReceivables {
  const result: AdvanceReceivables = { positions: [], invoiceIds: invoices.map((i) => i.id).sort(), receivables: 0, requests: 0, unbilled: 0, netAdvances: 0 };
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const origins = new Map(invoices.map((i) => [i.id, origin(i, byId).id]));
  const payments = settlements.filter((s) => s.date <= cutoff);
  for (const original of invoices.filter((i) => !i.correctsId && !i.replacesInvoiceId)) {
    const members = invoices.filter((i) => origins.get(i.id) === original.id);
    const paid = payments.filter((s) => origins.get(s.invoiceId) === original.id);
    const settled = paid.reduce((sum, s) => sum + s.amount, 0);
    const isAdvance = original.advanceType === "anzahlung";
    const performed = isAdvance
      ? deductions.some(
          (d) =>
            d.advanceId === original.id &&
            byId.get(d.invoiceId)?.variant === "schluss" &&
            !byId.get(d.invoiceId)!.replacesInvoiceId &&
            byId.get(d.invoiceId)!.performanceDate <= cutoff,
        )
      : original.performanceDate <= cutoff;
    if (isAdvance && !performed) result.netAdvances += paid.filter((s) => s.kind === "payment").reduce((sum, s) => sum + s.net, 0);
    const row = isAdvance && !performed ? requestAt(original, members, settled, cutoff) : claimAt(original, members, settled, performed, cutoff, byId);
    if (!row) continue;
    result.positions.push(row);
    if (row.kind === "request") result.requests += row.open;
    if (row.kind === "receivable" || row.kind === "unbilled") result.receivables += row.open;
    if (row.kind === "unbilled") result.unbilled += row.open;
  }
  result.positions.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
  return result;
}
