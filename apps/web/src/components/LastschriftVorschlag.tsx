import { formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format.ts";
import type { DirectDebitMatch } from "../server/modules/bank/index.ts";
import { Icon } from "./Icon.tsx";

/**
 * Bankabgleich (#445): Sammelgutschrift einer Lastschriftdatei auf ihre Rechnungen aufteilen oder eine Rücklastschrift
 * ihrer Lastschrift zuordnen. Gebucht wird erst auf Klick.
 */
export function LastschriftVorschlag({ match, busy, onAllocate }: { match: DirectDebitMatch | null; busy: boolean; onAllocate: () => void }) {
  if (!match) return null;
  if (match.kind === "sammler") {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="section-label">Sammler einer Lastschriftdatei</div>
        <div className="match-card">
          <div className="small muted">Einzug am {formatDate(match.collectionDate)}</div>
          <ul className="reasons">
            {match.parts.map((p) => (
              <li key={p.invoiceId} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>
                  <Icon name="check" size={16} />{" "}
                  <Link to="/rechnungen/$id" params={{ id: p.invoiceId }}>
                    Rechnung {p.number}
                  </Link>
                </span>
                <span className="amount">{formatEuro(p.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onAllocate}>
              Auf {match.parts.length} Rechnungen aufteilen
            </button>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Die Summe passt zu den Lastschriften eines Sammlers. Jede Rechnung bekommt ihren Betrag als Zahlung; aufheben lässt sich die Aufteilung nur zusammen.
        </p>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-label">Rücklastschrift</div>
      <div className="match-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Link to="/rechnungen/$id" params={{ id: match.invoiceId }} style={{ fontWeight: 600 }}>
              Rechnung {match.number}
            </Link>
            <span className="small muted">Mandat {match.mandateReference}</span>
          </div>
          <span className="amount">{formatEuro(match.amount)}</span>
        </div>
        <ul className="reasons">
          {match.reason && (
            <li>
              <Icon name="check" size={16} />
              Grund {match.reason.code}
              {match.reason.text ? `: ${match.reason.text}` : ""}
            </li>
          )}
          {match.fee > 0 && (
            <li>
              <Icon name="check" size={16} />
              Entgelt der Bank {formatEuro(match.fee)}, gebucht als Kontoführung und Bankgebühren
            </li>
          )}
        </ul>
        <div className="actions">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onAllocate}>
            Rechnung wieder öffnen
          </button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Die Bank hat die Lastschrift zurückgegeben. Die Rechnung ist danach wieder offen und steht unter Lastschriften zum erneuten Einzug, sofern das Mandat
        noch gilt.
      </p>
    </div>
  );
}
