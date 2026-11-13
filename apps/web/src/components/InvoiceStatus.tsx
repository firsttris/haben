import { formatEuro } from "@haben/core";
import { daysUntil, formatDayMonth, relativeDays } from "../lib/format.ts";
import type { InvoiceListStatus } from "../server/modules/rechnungen/index.ts";
import { Status, type StatusLook } from "./Status.tsx";

/** Was die Rechnungsliste je Rechnung liefert und der Status für seine Auskunft braucht */
export interface InvoiceStatusFacts {
  listStatus: InvoiceListStatus;
  dueDate: string;
  gross: number;
  paid: number;
  open: number;
  /** Letzte Zahlung oder Ausbuchung */
  settledOn?: string | null;
  /** Nummer des Stornos, das die Rechnung aufhebt */
  cancelledBy?: string | null;
  /** Bei Storno und Korrektur: Nummer der Rechnung, die sie betreffen */
  correctsNumber?: string | null;
}

const LOOK: Record<InvoiceListStatus, StatusLook> = {
  entwurf: { text: "Entwurf", draft: true },
  offen: { text: "Offen" },
  teilbezahlt: { text: "Teilbezahlt", tone: "info" },
  bezahlt: { text: "Bezahlt", tone: "ok" },
  ausgebucht: { text: "Ausgebucht" },
  // Geld steht aus und die Frist ist vorbei: der eine Zustand der Liste, der herausspringen soll
  ueberfaellig: { text: "Überfällig", tone: "warn", emphasis: "urgent" },
  storniert: { text: "Storniert", tone: "danger" },
  storno: { text: "Storno" },
  korrektur: { text: "Korrektur" },
};

/** Auskunft unter dem Status: was er für diese Rechnung gerade heißt */
export function invoiceStatusDetail(i: InvoiceStatusFacts): string | null {
  switch (i.listStatus) {
    case "entwurf":
      return "noch nicht festgeschrieben";
    case "offen":
      return `fällig ${formatDayMonth(i.dueDate)}`;
    case "teilbezahlt":
      return `${formatEuro(i.paid)} von ${formatEuro(i.gross)}`;
    case "ueberfaellig": {
      const since = relativeDays(daysUntil(i.dueDate));
      return i.open === i.gross ? since : `${since}, ${formatEuro(i.open)} offen`;
    }
    case "bezahlt":
      return i.settledOn ? `am ${formatDayMonth(i.settledOn)}` : null;
    case "ausgebucht":
      return "als Forderungsausfall";
    case "storniert":
      return i.cancelledBy ? `durch ${i.cancelledBy}` : null;
    case "storno":
    case "korrektur":
      return i.correctsNumber ? `zu ${i.correctsNumber}` : null;
  }
}

export function InvoiceStatus({ invoice }: { invoice: InvoiceStatusFacts }) {
  const { text, ...look } = LOOK[invoice.listStatus];
  return (
    <Status {...look} detail={invoiceStatusDetail(invoice)}>
      {text}
    </Status>
  );
}
