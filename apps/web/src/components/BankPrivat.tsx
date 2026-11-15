import { formatEuro } from "@haben/core";
import { formatDate } from "../lib/format.ts";
import type { Notice } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

/*
 * Umsatz auf einem privaten Konto, für den es dort keine Buchungsart gibt (#1088). Auf einem privaten Konto sind
 * „Privat", Bankgebühren, Zinserträge, Geldtransit und Spenden gesperrt; eine private Steuererstattung ließe sich also
 * nur buchen, indem man sie zum Betriebsvorgang macht. Statt sie als offenen Posten zu zeigen, kennzeichnet der
 * Betreiber sie einmal: Sie bleibt ungebucht, zählt nicht als offen, und die EÜR bleibt unberührt.
 */

/** Felder des Umsatzes, die die Kennzeichnung braucht */
type Umsatz = {
  bookingDate: string;
  amount: number;
  purpose: string | null;
  counterpartyName: string | null;
};

/**
 * Der Panel eines gekennzeichneten Umsatzes: „Zuordnen", „Direkt buchen" und „Aufteilen" wären eine zweite Aussage zum
 * selben Vorgang; sie gelten erst, wenn die Kennzeichnung aufgehoben ist.
 */
export function PrivatUmsatz({ tx, busy, notice, onAufheben }: { tx: Umsatz; busy: boolean; notice: Notice; onAufheben: () => void }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="small muted">Ausgewählter Umsatz · {formatDate(tx.bookingDate)}</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{tx.counterpartyName || "–"}</h2>
        <div className="amount" style={{ fontSize: 24, fontWeight: 600, color: tx.amount > 0 ? "var(--accent-ink)" : undefined }}>
          {tx.amount > 0 ? "+" : "−"}
          {formatEuro(Math.abs(tx.amount))}
        </div>
        <div className="small muted" style={{ overflowWrap: "anywhere" }}>
          {tx.purpose}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="section-label">Privat, kein Betriebsvorgang</div>
        <p className="small muted" style={{ margin: 0 }}>
          Auf diesem Konto gibt es für den Umsatz keine Buchungsart. Er bleibt ungebucht, zählt nicht als offener Posten, und die EÜR bleibt wie sie ist. Zum
          Buchen die Kennzeichnung aufheben.
        </p>
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onAufheben}>
          Kennzeichnung aufheben
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </>
  );
}

/** Angebot an einem offenen Umsatz des privaten Kontos, ihn aus den offenen Posten zu nehmen */
export function PrivatKennzeichnen({ busy, onKennzeichnen }: { busy: boolean; onKennzeichnen: () => void }) {
  return (
    <div className="actions">
      <button type="button" className="btn" disabled={busy} onClick={onKennzeichnen}>
        Privat, kein Betriebsvorgang
      </button>
      <span className="small muted">Für diesen Umsatz gibt es auf dem privaten Konto keine Buchungsart; kennzeichnen nimmt ihn aus den offenen Posten.</span>
    </div>
  );
}
