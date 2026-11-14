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
  // Du bist am Zug: die Rechnung schreiben
  angenommen: { text: "Angenommen", tone: "ok", emphasis: "notice" },
  abgelehnt: { text: "Abgelehnt", tone: "danger" },
  abgerechnet: { text: "Abgerechnet", tone: "ok" },
};

/** Auskunft unter dem Status; das Datum „Gültig bis“ steht in der Liste daneben, deshalb hier der Abstand */
export function quoteStatusDetail(q: QuoteStatusFacts): string | null {
  switch (q.listStatus) {
    // Der leere Ring sagt schon, dass nichts festgeschrieben ist
    case "entwurf":
      return null;
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

export function QuoteStatusBadge({ status }: { status: QuoteListStatus }) {
  const { text, ...look } = LOOK[status];
  return (
    <Status {...look} inline>
      {text}
    </Status>
  );
}

export function QuoteStatus({ quote, inline = false }: { quote: QuoteStatusFacts; inline?: boolean }) {
  const { text, ...look } = LOOK[quote.listStatus];
  return (
    <Status {...look} inline={inline} detail={inline ? null : quoteStatusDetail(quote)}>
      {text}
    </Status>
  );
}

/** Status einer Rechnung zum Angebot (Abschläge, Schlussrechnung): Entwurf, festgeschrieben oder storniert */
export function BillingStatus({ cancelled, final }: { cancelled: boolean; final: boolean }) {
  if (cancelled)
    return (
      <Status tone="danger" inline>
        Storniert
      </Status>
    );
  return final ? (
    <Status tone="ok" inline>
      Festgeschrieben
    </Status>
  ) : (
    <Status draft inline>
      Entwurf
    </Status>
  );
}
