import { daysUntil, relativeDays } from "../lib/format.ts";
import type { QuoteListStatus } from "../server/modules/rechnungen/index.ts";
import { Status, type StatusLook } from "./Status.tsx";

export interface QuoteStatusFacts {
  listStatus: QuoteListStatus;
  validUntil: string;
  /** Nummer der Rechnung, mit der das Angebot abgerechnet ist */
  invoiceNumber?: string | null;
}

const LOOK: Record<QuoteListStatus, StatusLook> = {
  entwurf: { text: "Entwurf", draft: true },
  offen: { text: "Offen" },
  // Nachfassen lohnt sich, eine Frist gibt es nicht
  abgelaufen: { text: "Abgelaufen", tone: "warn", emphasis: "notice" },
  angenommen: { text: "Angenommen", tone: "ok" },
  abgelehnt: { text: "Abgelehnt", tone: "danger" },
  abgerechnet: { text: "Abgerechnet", tone: "ok" },
};

/** Auskunft unter dem Status; das Datum „Gültig bis“ steht in der Liste daneben, deshalb hier der Abstand */
export function quoteStatusDetail(q: QuoteStatusFacts): string | null {
  switch (q.listStatus) {
    case "entwurf":
      return "noch nicht festgeschrieben";
    case "offen": {
      const days = daysUntil(q.validUntil);
      return days === 0 ? "gilt bis heute" : `gilt noch ${days === 1 ? "1 Tag" : `${days} Tage`}`;
    }
    case "abgelaufen":
      return relativeDays(daysUntil(q.validUntil));
    case "angenommen":
      return "noch nicht abgerechnet";
    case "abgerechnet":
      return q.invoiceNumber ? `mit ${q.invoiceNumber}` : null;
    case "abgelehnt":
      return null;
  }
}

export function QuoteStatus({ quote, inline = false }: { quote: QuoteStatusFacts; inline?: boolean }) {
  const { text, ...look } = LOOK[quote.listStatus];
  return (
    <Status {...look} inline={inline} detail={inline ? null : quoteStatusDetail(quote)}>
      {text}
    </Status>
  );
}
