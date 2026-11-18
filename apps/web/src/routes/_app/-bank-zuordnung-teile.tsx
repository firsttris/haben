import { formatEuro } from "@haben/core";
import { vorschlagTitel } from "../../components/DirektVorschlag.ts";
import { Icon } from "../../components/Icon.tsx";
import { formatDate } from "../../lib/format.ts";
import { type Allocation, type Data, type Detail, itemLabel, zuordnungText } from "./-bank-daten.ts";

/*
 * Anzeigeteile der Zuordnung eines Bankumsatzes (AllocationPanel in -bank-zuordnung.tsx): Kopf mit dem Umsatz, die
 * bisherigen Zuordnungen, der beste Treffer und der Vorschlag ohne Rechnung.
 */

type Direct = NonNullable<Detail["direct"]>;
type Counterpart = NonNullable<Direct["counterpart"]>;

export function UmsatzKopf({ tx }: { tx: Detail["transaction"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="small muted">Ausgewählter Umsatz · {formatDate(tx.bookingDate)}</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{tx.counterpartyName || "–"}</h2>
      <div className="amount" style={{ fontSize: 24, fontWeight: 600, color: tx.amount > 0 ? "var(--accent-ink)" : undefined }}>
        {tx.amount > 0 ? "+" : "−"}
        {formatEuro(Math.abs(tx.amount))}
      </div>
      <div className="small muted" style={{ overflowWrap: "anywhere" }}>
        {tx.purpose}
        {tx.counterpartyIban ? ` · ${tx.counterpartyIban.replace(/(.{4})/g, "$1 ").trim()}` : ""}
      </div>
      {tx.open !== 0 && tx.open !== tx.amount && <div className="small">Noch offen: {formatEuro(Math.abs(tx.open))}</div>}
    </div>
  );
}

/** Teile einer Aufteilung werden nur zusammen aufgehoben: Knopf nur am ersten Teil */
function ersteTeile(allocations: Allocation[]): Set<string> {
  const firstOfSplit = new Set<string>();
  const seenSplits = new Set<string>();
  for (const a of allocations) {
    if (a.splitId && !seenSplits.has(a.splitId)) {
      seenSplits.add(a.splitId);
      firstOfSplit.add(a.id);
    }
  }
  return firstOfSplit;
}

export function ZuordnungenListe({
  allocations,
  gesellschaft,
  busy,
  onAufheben,
}: {
  allocations: Allocation[];
  gesellschaft: boolean;
  busy: boolean;
  onAufheben: (a: Allocation) => void;
}) {
  if (allocations.length === 0) return null;
  const firstOfSplit = ersteTeile(allocations);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="section-label">Zugeordnet</div>
      {allocations.map((a) => (
        <div key={a.id} className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ textDecoration: a.reversed ? "line-through" : undefined }}>{zuordnungText(a, gesellschaft)}</span>
            <span className="small muted">
              {a.reversed ? "aufgehoben" : a.splitId ? `${a.amount < 0 ? "−" : "+"}${formatEuro(Math.abs(a.amount))}` : formatEuro(Math.abs(a.amount))}
              {a.splitId ? " · Teil einer Aufteilung" : ""}
            </span>
          </div>
          {!a.reversed && (!a.splitId || firstOfSplit.has(a.id)) && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onAufheben(a)} disabled={busy}>
              {a.splitId ? "Aufteilung aufheben" : "Aufheben"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function BesterTreffer({ best }: { best: Detail["suggestions"][number] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-label">Bester Treffer</div>
      <div className="match-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{best.item.type === "document" ? `Beleg ${best.item.partyName}` : itemLabel(best.item)}</span>
            <span className="small muted">
              {best.item.type === "ustva"
                ? `${best.item.open < 0 ? "fällig" : "Erstattung ab"} ${formatDate(best.item.date)}`
                : `vom ${formatDate(best.item.date)}`}
              {best.item.dueDate && best.item.type !== "ustva" ? ` · fällig ${formatDate(best.item.dueDate)}` : ""}
              {best.item.type === "document" && best.item.number ? ` · ${best.item.number}` : ""}
            </span>
          </div>
          <span className="amount">{formatEuro(Math.abs(best.item.open))}</span>
        </div>
        <ul className="reasons">
          {best.reasons.map((reason) => (
            <li key={reason}>
              <Icon name="check" size={16} />
              {reason}
            </li>
          ))}
        </ul>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {best.item.type === "invoice"
          ? "Deckt die Zahlung den offenen Betrag, gilt die Rechnung als bezahlt (Bank an Forderungen). Bei Ist-Versteuerung wird die Umsatzsteuer anteilig mit der Zahlung fällig."
          : best.item.type === "ustva"
            ? "Bucht wie „Umsatzsteuer an das Finanzamt“ (Umsatzsteuer-Vorauszahlungen), mit Bezug auf die Voranmeldung."
            : "Bucht Verbindlichkeiten an Bank."}
      </p>
    </div>
  );
}

export function DirektVorschlagKarte({
  direct,
  directKinds,
  busy,
  onTransit,
}: {
  direct: Direct;
  directKinds: Data["directKinds"];
  busy: boolean;
  onTransit: (counterpart: Counterpart) => void;
}) {
  const counterpart = direct.counterpart;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-label">Vorschlag ohne Rechnung</div>
      <div className="match-card">
        <span style={{ fontWeight: 600 }}>{vorschlagTitel(direct) ?? directKinds.find((k) => k.value === direct.kind)?.label}</span>
        <ul className="reasons">
          {direct.reasons.map((reason) => (
            <li key={reason}>
              <Icon name="check" size={16} />
              {reason}
            </li>
          ))}
        </ul>
      </div>
      {counterpart && (
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => onTransit(counterpart)}>
            Beide Seiten als Geldtransit buchen
          </button>
          <span className="small muted">
            Geld zwischen deinen eigenen Konten: Gegenbuchung vom {formatDate(counterpart.bookingDate)} über {formatEuro(Math.abs(counterpart.amount))} auf dem
            anderen Konto
            {counterpart.payoutIds?.length ? ` (Auszahlung aus ${counterpart.payoutIds.length + 1} Teilen)` : ""}; alles wird in einem Schritt zugeordnet.
          </span>
        </>
      )}
    </div>
  );
}
