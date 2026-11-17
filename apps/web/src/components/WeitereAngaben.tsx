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

/**
 * USt-IdNr. aus einem anderen EU-Land (ohne DE; Griechenland hat EL): Länderkennzeichen und danach 5 bis 12 Zeichen wie in
 * `ustIdProblem` (packages/core/src/zm.ts), denn dort lehnt der Server eine kürzere beim Erwerb ab
 */
const EU_VAT_PREFIX = /^(AT|BE|BG|CY|CZ|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z+*]{5,12}$/;
export const isEuVatId = (text: string) => EU_VAT_PREFIX.test(text.replace(/\s/g, "").toUpperCase());

/** Wie das Schema des Servers (`documentInputSchema`): ein Leistungsende vor dem Beginn lehnt er ab */
export const leistungsendeFehler = (serviceFrom: string, serviceTo: string) =>
  serviceFrom && serviceTo && serviceFrom > serviceTo ? "Das Ende der Leistung liegt vor dem Beginn." : null;

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
