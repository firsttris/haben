import { useId, type ReactNode } from "react";

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
 * gleich. describedBy nennt Hinweise, die außerhalb stehen, etwa einen gemeinsamen für zwei Felder.
 */
export function Field({
  label,
  hint,
  error,
  describedBy,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  describedBy?: string | undefined;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const description = [describedBy, hintId, errorId].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, "aria-describedby": description || undefined, "aria-invalid": error ? true : undefined })}
      {hintId && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {errorId && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
