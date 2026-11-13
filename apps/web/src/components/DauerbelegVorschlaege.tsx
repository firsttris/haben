import { formatEuro, type Suggestion } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";

/**
 * Bankabgleich: ungebuchte Belege aus Dauerbelegen mit passendem Betrag. Gebucht wird erst auf Klick, zusammen mit der
 * Zuordnung; wer erst prüfen will, öffnet den Beleg.
 */
export function DauerbelegVorschlaege({ suggestions, busy, onBook }: { suggestions: Suggestion[]; busy: boolean; onBook: (documentId: string) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-label">Dauerbeleg, noch zu prüfen</div>
      {suggestions.map((s) => (
        <div key={s.item.id} className="match-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600 }}>Beleg {s.item.partyName}</span>
              <span className="small muted">
                vom {formatDate(s.item.date)}
                {s.item.dueDate ? ` · fällig ${formatDate(s.item.dueDate)}` : ""}
                {s.item.number ? ` · ${s.item.number}` : ""}
              </span>
            </div>
            <span className="amount">{formatEuro(Math.abs(s.item.open))}</span>
          </div>
          <ul className="reasons">
            {s.reasons.map((reason) => (
              <li key={reason}>
                <Icon name="check" size={16} />
                {reason}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onBook(s.item.id)}>
              Buchen und zuordnen
            </button>
            <Link to="/belege/$id" params={{ id: s.item.id }} className="btn btn-sm">
              Beleg prüfen
            </Link>
          </div>
        </div>
      ))}
      <p className="small muted" style={{ margin: 0 }}>
        Bucht den Beleg wie „Bestätigen und buchen“ und danach Verbindlichkeiten an Bank.
      </p>
    </div>
  );
}
