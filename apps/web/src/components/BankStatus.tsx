import { formatEuro } from "@haben/core";
import { daysUntil, formatDate, formatDayMonth, relativeDays } from "../lib/format.ts";
import { Status, type StatusLook } from "./Status.tsx";

type Hint = "vorschlag" | "belegFehlt" | "offen" | "teilweise" | "zugeordnet" | "verrechnet";

const HINT: Record<Hint, StatusLook> = {
  // Ein Klick erledigt den Umsatz: hebt die Zeilen hervor, die ohne Suchen gehen
  vorschlag: { text: "Vorschlag", tone: "info", emphasis: "notice" },
  // Eine Arbeitsliste: viele Zeilen sind offen, deshalb „notice“ und nicht „urgent“ (DESIGN.md › Status)
  belegFehlt: { text: "Beleg fehlt", tone: "warn", emphasis: "notice" },
  offen: { text: "Offen" },
  teilweise: { text: "Teilweise", tone: "info" },
  zugeordnet: { text: "Zugeordnet", tone: "ok" },
  verrechnet: { text: "Verrechnet", tone: "ok" },
};

const SUGGESTION_KIND = { invoice: "Rechnung", document: "Beleg", ustva: "Voranmeldung" } as const;

interface TransactionFacts {
  hint: Hint;
  open: number;
  suggestion: { type: keyof typeof SUGGESTION_KIND; number: string; partyName: string } | null;
}

/** Auskunft unter dem Hinweis eines Umsatzes: wohin der Vorschlag passt, was noch offen ist */
export function transactionStatusDetail(tx: TransactionFacts): string | null {
  if (tx.hint === "vorschlag" && tx.suggestion) {
    const s = tx.suggestion;
    return s.type === "document" ? s.partyName || `Beleg ${s.number}` : `${SUGGESTION_KIND[s.type]} ${s.number}`.trim();
  }
  if (tx.hint === "teilweise") return `noch ${formatEuro(Math.abs(tx.open))} offen`;
  return null;
}

/** Hinweis eines Umsatzes in der Liste des Bankabgleichs */
export function TransactionStatus({ tx }: { tx: TransactionFacts }) {
  const { text, ...look } = HINT[tx.hint];
  return (
    <Status {...look} detail={transactionStatusDetail(tx)}>
      {text}
    </Status>
  );
}

const CONNECTION_STATUS: Record<"aktiv" | "abgelaufen" | "fehler" | "widerrufen" | "wartet", StatusLook> = {
  aktiv: { text: "Aktiv", tone: "ok" },
  // Ohne Verbindung kommen keine Umsätze mehr: der Abgleich bleibt stehen
  abgelaufen: { text: "Abgelaufen", tone: "warn", emphasis: "urgent" },
  fehler: { text: "Fehler", tone: "danger", emphasis: "urgent" },
  widerrufen: { text: "Getrennt", tone: "neutral" },
  wartet: { text: "Wartet auf Bank", tone: "info" },
};

/** Zustand einer Verbindung zum automatischen Abruf; läuft die Zustimmung bald ab, ist das dringend */
export function ConnectionStatus({ connection: c }: { connection: { status: keyof typeof CONNECTION_STATUS; renewSoon: boolean; validUntil: string | null } }) {
  if (c.renewSoon)
    return (
      <Status
        tone="warn"
        emphasis="urgent"
        inline
        detail={c.validUntil ? `${relativeDays(daysUntil(c.validUntil))}, am ${formatDayMonth(c.validUntil)}` : null}
      >
        Läuft bald ab
      </Status>
    );
  const { text, ...look } = CONNECTION_STATUS[c.status];
  return (
    <Status {...look} inline detail={c.status === "aktiv" && c.validUntil ? `bis ${formatDate(c.validUntil)}` : null}>
      {text}
    </Status>
  );
}
