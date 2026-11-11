import { type ReactNode, useRef } from "react";

/**
 * Knopf, der eine Datei hochlädt, statt sie in ein Formular zu legen (Belege, Kontoauszüge, Anhänge, Logo).
 *
 * Bedient wird nur der Knopf; das Eingabefeld dahinter ist unsichtbar, mit `tabIndex={-1}` aus der Tab-Reihenfolge und
 * mit `aria-hidden` aus dem Accessibility-Baum. Sonst landete die Tastatur zweimal an derselben Aktion, und Screenreader
 * fänden zwei Knöpfe mit demselben Namen. Sein `aria-label` bleibt für die Tests (`setInputFiles`). Nach der Wahl leert der Knopf das Feld wieder, damit dieselbe Datei ein zweites Mal ein
 * `change` auslöst, etwa nach einem Fehler. Für ein Datei-Feld in einem Formular gilt `FilePicker` in `Field`
 * (DESIGN.md, „Datei-Felder“).
 */
export function UploadButton({
  children,
  onFiles,
  accept,
  multiple,
  capture,
  disabled,
  className = "btn",
  inputLabel,
  "aria-describedby": describedBy,
}: {
  children: ReactNode;
  /** Bekommt die gewählten Dateien, nie eine leere Liste */
  onFiles: (files: File[]) => unknown;
  accept?: string;
  multiple?: boolean;
  capture?: "user" | "environment";
  disabled?: boolean;
  className?: string;
  /** Name des Eingabefelds, etwa „Kontoauszugsdateien“ */
  inputLabel: string;
  "aria-describedby"?: string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} aria-describedby={describedBy} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        className="visually-hidden"
        aria-label={inputLabel}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) void onFiles(files);
        }}
      />
    </>
  );
}
