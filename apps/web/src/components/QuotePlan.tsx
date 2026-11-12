import { formatEuro, formatPercent, PLAN_ROW_STATUS_LABEL, planShareLabel, type PlanRowStatus } from "@haben/core";
import { Link } from "@tanstack/react-router";
import type { getQuoteDetail } from "../server/functions/quotes.ts";

type Overview = NonNullable<Awaited<ReturnType<typeof getQuoteDetail>>["plan"]>;

const PILL: Record<PlanRowStatus, string> = { offen: "", entwurf: "pill-info", festgeschrieben: "pill-warn", bezahlt: "pill-ok" };

/**
 * Zahlungsplan auf dem festgeschriebenen Angebot: je Zeile Plan (netto und brutto), Ist mit Link zur Rechnung, Status
 * und der Knopf für die Abschlagsrechnung bzw. beim Rest die Schlussrechnung; darunter der Fortschritt.
 */
export function QuotePlan({
  plan,
  taxed,
  canBill,
  busy,
  onAbschlag,
  onSchluss,
}: {
  plan: Overview;
  /** Mit Steuerausweis: Netto und Brutto, sonst ein Betrag */
  taxed: boolean;
  /** Angebot nicht abgelehnt und noch nicht ganz abgerechnet */
  canBill: boolean;
  busy: boolean;
  onAbschlag: (row: number) => void;
  onSchluss: () => void;
}) {
  const { progress } = plan;
  return (
    <section className="card" aria-labelledby="plan-heading">
      <h2 id="plan-heading">Zahlungsplan</h2>
      {plan.problem && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {plan.problem}. Passe die Auswahl an oder schreib ein neues Angebot.
        </p>
      )}
      {plan.rows.map((row) => {
        const rest = row.share.kind === "rest";
        return (
          <div key={row.index} className="history-row">
            <span style={{ minWidth: 0 }}>
              <strong>
                {row.index + 1}. {row.label}
              </strong>{" "}
              · {planShareLabel(row.share, formatPercent, formatEuro, "Rest")}
              {row.due && ` · fällig bei ${row.due}`}
              <span className="small muted" style={{ display: "block" }}>
                Plan: <span className="amount">{taxed ? `${formatEuro(row.net)} netto · ${formatEuro(row.gross)} brutto` : formatEuro(row.gross)}</span>
              </span>
              {row.invoice && (
                <span className="small muted" style={{ display: "block" }}>
                  Ist:{" "}
                  <Link to="/rechnungen/$id" params={{ id: row.invoice.id }}>
                    {rest ? "Schlussrechnung" : "Abschlagsrechnung"} {row.invoice.number ?? "(Entwurf)"}
                  </Link>{" "}
                  · <span className="amount">{formatEuro(row.invoice.gross)}</span>
                </span>
              )}
              {canBill && row.status === "offen" && !plan.problem && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={() => (rest ? onSchluss() : onAbschlag(row.index))}
                  disabled={busy}
                  aria-label={`${rest ? "Schlussrechnung erstellen" : "Abschlagsrechnung erstellen"}: Zahlung ${row.index + 1}`}
                >
                  {rest ? "Schlussrechnung erstellen" : "Abschlagsrechnung erstellen"}
                </button>
              )}
            </span>
            <span className={`pill ${PILL[row.status]}`}>{PLAN_ROW_STATUS_LABEL[row.status]}</span>
          </div>
        );
      })}
      <p className="small" style={{ margin: 0 }} aria-live="polite">
        Abgerechnet <span className="amount">{formatEuro(progress.billed)}</span> von <span className="amount">{formatEuro(progress.total)}</span> (
        {formatPercent(progress.percent)}), offen <span className="amount">{formatEuro(progress.open)}</span>
      </p>
      <progress value={Math.max(0, Math.min(progress.billed, progress.total))} max={Math.max(progress.total, 1)} aria-label="Abgerechnet vom Auftrag" />
    </section>
  );
}
