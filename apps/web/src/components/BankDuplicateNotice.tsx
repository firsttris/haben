import { formatDate } from "../lib/format.ts";
import type { DuplicateDecisionInput } from "../server/modules/bank/index.ts";

type Transaction = {
  bookingDate: string;
  counterpartyName: string | null;
  purpose: string | null;
};

type DuplicateReview = {
  id: string;
  originalDate: string;
  originalName: string | null;
  originalPurpose: string | null;
  decision: "pending" | "duplicate" | "distinct";
  decisionId: string | null;
  requestId: string;
  sharedFetch: boolean;
  confirmationBlockReason: string | null;
};

type Props = {
  tx: Transaction;
  reviews: readonly DuplicateReview[];
  busy: boolean;
  onDecision: (input: DuplicateDecisionInput) => void;
};

export function BankDuplicateNotice({ tx, reviews, busy, onDecision }: Props) {
  if (reviews.length === 0) return null;
  const confirmed = reviews.some((review) => review.decision === "duplicate");
  const pending = reviews.some((review) => review.decision === "pending");

  return (
    <section aria-label="Dublettenprüfung" className={pending ? "banner banner-warn" : "banner"} style={{ display: "grid", gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>{confirmed ? "Bestätigte Dublette" : pending ? "Mögliche Dublette" : "Keine Dublette"}</h3>
      <dl
        style={{
          color: "var(--ink)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
          gap: 12,
          margin: 0,
          overflowWrap: "anywhere",
        }}
      >
        <div className="stack" style={{ gap: 4 }}>
          <dt style={{ fontWeight: 600 }}>Ausgewählter Umsatz</dt>
          <dd style={{ margin: 0 }}>
            <TransactionText date={tx.bookingDate} name={tx.counterpartyName} purpose={tx.purpose} />
          </dd>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <dt style={{ fontWeight: 600 }}>{reviews.length === 1 ? "Ähnlicher Umsatz" : "Ähnliche Umsätze"}</dt>
          {reviews.map((review) => (
            <dd key={review.id} className="stack" style={{ margin: 0, gap: 4 }}>
              <TransactionText date={review.originalDate} name={review.originalName} purpose={review.originalPurpose} />
              {review.decision === "duplicate" && review.sharedFetch && (
                <div className="small">Die Bank hat beide Umsätze später gemeinsam geliefert. Prüfe die Dublettenentscheidung.</div>
              )}
              {review.confirmationBlockReason && <div className="small">{review.confirmationBlockReason}</div>}
              <DecisionActions review={review} busy={busy} onDecision={onDecision} />
            </dd>
          ))}
        </div>
      </dl>
    </section>
  );
}

function TransactionText({ date, name, purpose }: { date: string; name: string | null; purpose: string | null }) {
  return (
    <div>
      <div className="small">{[formatDate(date), name].filter(Boolean).join(" · ")}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{purpose?.trim() ? purpose : "Kein Verwendungszweck"}</div>
    </div>
  );
}

function DecisionActions({ review, busy, onDecision }: Pick<Props, "busy" | "onDecision"> & { review: DuplicateReview }) {
  const { id, decision, decisionId, requestId } = review;
  if (decisionId) {
    return (
      <div className="actions">
        <span className="small">{decision === "duplicate" ? "Als Dublette bestätigt" : "Eigenständiger Umsatz"}</span>
        <button type="button" className="btn" disabled={busy} onClick={() => onDecision({ id, decision: "pending", decisionId })}>
          Entscheidung zurücknehmen
        </button>
      </div>
    );
  }
  return (
    <div className="actions">
      <button
        type="button"
        className="btn"
        disabled={busy || Boolean(review.confirmationBlockReason)}
        onClick={() => onDecision({ id, decision: "duplicate", requestId })}
      >
        Ist eine Dublette
      </button>
      <button type="button" className="btn" disabled={busy} onClick={() => onDecision({ id, decision: "distinct", requestId })}>
        Keine Dublette
      </button>
    </div>
  );
}
