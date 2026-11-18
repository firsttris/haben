import { normalizeUstId, ustIdAufbauProblem, ustIdProblem } from "@haben/core";
import type { ReactNode } from "react";
import { formatDate } from "../lib/format.ts";
import type { BookingIssue } from "../server/modules/belege/index.ts";

export interface WeitereAngabenWerte {
  currency: string;
  ustId: string;
  dueDate: string;
  serviceFrom: string;
  serviceTo: string;
  note: string;
}

/**
 * Die Felder in „Weitere Angaben“, benannt wie am Beleg (`documentInputSchema`). Meldet die Prüfung im Browser oder der Server
 * einen Fehler an einem davon, klappt die Seite den Bereich auf.
 */
const WEITERE_ANGABEN_FELDER = [
  "supplierUstId",
  "dueDate",
  "serviceFrom",
  "serviceTo",
  "currency",
  "exchangeRate",
  "exchangeRateDate",
  "note",
] as const satisfies readonly NonNullable<BookingIssue["feld"]>[];
type WeitereAngabenFeld = (typeof WEITERE_ANGABEN_FELDER)[number];
export const inWeitereAngaben = (feld: string | undefined): feld is WeitereAngabenFeld => (WEITERE_ANGABEN_FELDER as readonly string[]).includes(feld ?? "");

/**
 * USt-IdNr. aus einem anderen EU-Land, wie der Server sie beim Erwerb annimmt (`ustIdProblem`, Aufbau je Mitgliedstaat);
 * ohne Nordirland (XI), dessen Nummern nur für Waren gelten, nicht für den Hinweis auf § 13b
 */
export const isEuVatId = (text: string) => {
  const ustId = normalizeUstId(text);
  return !ustId.startsWith("XI") && (ustIdProblem(ustId, "L") ?? ustIdAufbauProblem(ustId)) === null;
};

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
      <summary
        onClick={(event) => {
          // Der Zustand gehört der Seite: Der Browser meldet das Umschalten erst im nächsten Bild, bis dahin hinkte `offen` hinterher
          event.preventDefault();
          onOffen(!offen);
        }}
      >
        <strong>Weitere Angaben</strong>
        {kurz && <span className="muted">: {kurz}</span>}
      </summary>
      <div className="form-grid" style={{ marginTop: 12 }}>
        {children}
      </div>
    </details>
  );
}
