import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatDate } from "./format.ts";

/** Je Feld der Fehler als Satz, der sagt, was zu tun ist, oder null, wenn die Angabe stimmt */
export type FieldErrors<K extends string> = Record<K, string | null>;

/**
 * Prüfung beim Absenden statt gesperrtem Knopf (DESIGN.md, Gesperrte Knöpfe): Die Fehler rechnet das Formular bei jedem
 * Rendern aus, zu sehen sind sie erst nach dem ersten Druck auf den Knopf und verschwinden dann, sobald die Angabe stimmt.
 * `check` steht zuerst im onSubmit: false heißt abbrechen; dann bekommt das erste Feld mit `aria-invalid` den Fokus, und der
 * Screenreader liest dabei dessen Fehler über `aria-describedby`. Geht die Prüfung durch, verschwinden die Fehler wieder,
 * damit ein Formular, das sich nach dem Buchen leert, nicht sofort „fehlt“ meldet. `form` gehört an das `<form>`, das
 * `noValidate` trägt.
 */
export function useSubmitCheck<K extends string>(errors: FieldErrors<K>) {
  const [shown, setShown] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  return {
    form,
    error: (key: K): string | undefined => (shown ? (errors[key] ?? undefined) : undefined),
    check(): boolean {
      if (Object.values<string | null>(errors).every((e) => e === null)) {
        setShown(false);
        return true;
      }
      // Sofort rendern, damit die Felder aria-invalid tragen, bevor der Fokus sie sucht
      flushSync(() => setShown(true));
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return false;
    },
  };
}

const monthFormat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const monatName = (monat: string) => monthFormat.format(new Date(`${monat}-01T00:00:00Z`));

/**
 * Fehler eines Datumsfelds (JJJJ-MM-TT) mit Grenzen wie `min` und `max`; die prüft der Browser mit `noValidate` nicht mehr.
 * Leer gilt als fehlend.
 */
export function datumFehler(value: string, min: string, max: string): string | null {
  if (value === "") return "Wähle das Datum.";
  return value < min || value > max ? `Wähle einen Tag vom ${formatDate(min)} bis ${formatDate(max)}.` : null;
}

/** Wie datumFehler für ein Monatsfeld (JJJJ-MM) */
export function monatFehler(value: string, min: string, max: string): string | null {
  if (value === "") return "Wähle den Monat.";
  if (value >= min && value <= max) return null;
  return min === max ? `Wähle ${monatName(min)}.` : `Wähle einen Monat von ${monatName(min)} bis ${monatName(max)}.`;
}
