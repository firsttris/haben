import { useState, type Ref } from "react";

/**
 * Dateiauswahl mit deutscher Beschriftung; der Browser schreibt sonst je nach Sprache „Choose Files“.
 * Gehört in ein <label>, das Eingabefeld bleibt für Tastatur und Formular erreichbar.
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
  return (
    <span className="file-picker">
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
