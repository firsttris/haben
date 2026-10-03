import type { QuoteListStatus } from "../server/quotes.ts";

const LABELS: Record<QuoteListStatus, { text: string; tone: string }> = {
  entwurf: { text: "Entwurf", tone: "pill-info" },
  offen: { text: "Offen", tone: "" },
  abgelaufen: { text: "Abgelaufen", tone: "pill-warn" },
  angenommen: { text: "Angenommen", tone: "pill-ok" },
  abgelehnt: { text: "Abgelehnt", tone: "pill-danger" },
  abgerechnet: { text: "Abgerechnet", tone: "pill-ok" },
};

export function QuoteStatus({ status }: { status: QuoteListStatus }) {
  const { text, tone } = LABELS[status];
  return <span className={`pill ${tone}`}>{text}</span>;
}
