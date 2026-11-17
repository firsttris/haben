import type { ReactNode } from "react";
import { formatDate } from "../lib/format.ts";

export interface WeitereAngabenWerte {
  currency: string;
  ustId: string;
  dueDate: string;
  serviceFrom: string;
  serviceTo: string;
  note: string;
}

/** Was in „Weitere Angaben“ gesetzt ist, für die Überschrift des zugeklappten Bereichs: „EUR · fällig 30.11.2026“ */
export function weitereAngabenKurz(werte: WeitereAngabenWerte): string {
  const leistung =
    werte.serviceFrom && werte.serviceTo
      ? `Leistung ${formatDate(werte.serviceFrom)} bis ${formatDate(werte.serviceTo)}`
      : werte.serviceFrom
        ? `Leistung ab ${formatDate(werte.serviceFrom)}`
        : werte.serviceTo
          ? `Leistung bis ${formatDate(werte.serviceTo)}`
          : "";
  return [
    werte.currency.trim().toUpperCase(),
    werte.ustId.trim() && `USt-IdNr. ${werte.ustId.trim()}`,
    werte.dueDate && `fällig ${formatDate(werte.dueDate)}`,
    leistung,
    werte.note.trim() && "Notiz",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Aufklappbarer Bereich für Seltenes am Beleg (#1253). `offen` und `onOffen` hält die Seite selbst, damit sie den Bereich
 * aufklappen kann, wenn ein Feld darin einen Fehler hat oder gebraucht wird: Ein Fehler im zugeklappten Bereich fände
 * weder Fokus noch Auge. Die gesetzten Werte stehen in der Überschrift, nichts fällt weg.
 */
export function WeitereAngaben({ kurz, offen, onOffen, children }: { kurz: string; offen: boolean; onOffen: (offen: boolean) => void; children?: ReactNode }) {
  return (
    <details className="weitere-angaben" open={offen} onToggle={(event) => onOffen(event.currentTarget.open)} style={{ gridColumn: "1 / -1" }}>
      <summary>
        <strong>Weitere Angaben</strong>
        {kurz && <span className="muted">: {kurz}</span>}
      </summary>
      <div className="form-grid" style={{ marginTop: 12 }}>
        {children}
      </div>
    </details>
  );
}
