import { useState, type MouseEvent, type Ref } from "react";

/**
 * Dateiauswahl mit deutscher Beschriftung; der Browser schreibt sonst je nach Sprache „Choose Files“.
 *
 * Der Klick auf die Fläche öffnet den Dialog selbst: Der Knopf ist nur ein `span`, ein umschließendes
 * `<label>` hat ihn bisher zum Auslöser gemacht. `Field` umschließt seine Felder aber bewusst nicht mit
 * einem `<label>` (siehe `Field.tsx`), dort trägt nur der Feldname den Klick — der Knopf daneben blieb
 * ohne Wirkung. `preventDefault` nimmt einem umschließenden `<label>` den zweiten Weg, sonst öffneten
 * sich zwei Dialoge. Deshalb setzt der Handler auch den Fokus selbst, den sonst das Label gesetzt hätte; ohne ihn springt
 * Tab danach an den Seitenanfang. Ein Klick, der vom Eingabefeld selbst kommt, bleibt unberührt: Auch das Ereignis aus `click()` und
 * die Tastatur kommen hier an, und `preventDefault` bräche dann den Dialog ab. Das Eingabefeld bleibt für Tastatur und
 * Formular erreichbar.
 */
export function FilePicker({
  name,
  accept,
  multiple,
  required,
  id,
  inputRef,
  ariaLabel,
}: {
  name?: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const open = (event: MouseEvent<HTMLSpanElement>) => {
    const input = event.currentTarget.querySelector<HTMLInputElement>("input[type=file]");
    if (event.target === input) return;
    event.preventDefault();
    input?.focus();
    input?.click();
  };
  return (
    <span className="file-picker" onClick={open}>
      <input
        id={id}
        ref={inputRef}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        aria-label={ariaLabel}
        className="visually-hidden"
        onChange={(e) => setFiles([...(e.target.files ?? [])].map((f) => f.name))}
      />
      <span className="btn btn-sm" aria-hidden="true">
        {multiple ? "Dateien wählen" : "Datei wählen"}
      </span>
      <span className="file-picker-name">
        {files.length === 0 ? (multiple ? "Keine Dateien gewählt" : "Keine Datei gewählt") : files.length > 2 ? `${files.length} Dateien` : files.join(", ")}
      </span>
    </span>
  );
}
