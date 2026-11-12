import { type CSSProperties, type ReactNode, useId } from "react";

/** Gehört aufs Eingabefeld, damit Feldname, Hinweis und Fehler mit ihm verbunden sind */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

/**
 * Feldname, Eingabefeld und Hinweis in der Form, die alle Formulare teilen.
 *
 * Bewusst kein umschließendes `<label>`: Dessen Fläche reicht über die ganze Zeile, ein Klick neben den Feldnamen träfe
 * das Feld, und ein Hinweis darin würde zum zugänglichen Namen des Felds. Hier ist das `<label>` nur so breit wie der
 * Feldname (`.field-label`).
 *
 * children bekommt die Eigenschaften und gibt sie ans Feld weiter, so geht es für `input`, `select` und eigene Komponenten
 * gleich. describedBy nennt Hinweise, die außerhalb stehen, etwa einen gemeinsamen für zwei Felder. announceError liest
 * einen Fehler sofort vor, wenn er erst nach einer Aktion erscheint; beim Tippen wäre das zu viel. className und style
 * gehören an die Hülle, etwa für `gridColumn`. hideLabel nimmt den Feldnamen aus dem Bild, er bleibt für Screenreader und
 * Sprachsteuerung (Suchfelder ohne sichtbare Beschriftung).
 */
export function Field({
  label,
  hint,
  error,
  describedBy,
  announceError = false,
  hideLabel = false,
  className,
  style,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  describedBy?: string | undefined;
  announceError?: boolean;
  hideLabel?: boolean;
  className?: string;
  style?: CSSProperties;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const description = [describedBy, hintId, errorId].filter(Boolean).join(" ");
  return (
    <div className={className ? `field ${className}` : "field"} style={style}>
      <label className={hideLabel ? "field-label visually-hidden" : "field-label"} htmlFor={id}>
        {label}
      </label>
      {children({ id, "aria-describedby": description || undefined, "aria-invalid": error ? true : undefined })}
      {hintId && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {errorId && (
        <span id={errorId} className="field-error" role={announceError ? "alert" : undefined}>
          {error}
        </span>
      )}
    </div>
  );
}
