import { type ComponentProps, type KeyboardEvent, useRef, useState } from "react";
import { type TextEdit, type TextStyle, toggleTextStyle } from "@haben/core";

const BUTTONS: { style: TextStyle; label: string; glyph: React.ReactNode; key: string }[] = [
  { style: "bold", label: "Fett", glyph: <strong>F</strong>, key: "B" },
  { style: "italic", label: "Kursiv", glyph: <em>K</em>, key: "I" },
  { style: "underline", label: "Unterstrichen", glyph: <u>U</u>, key: "U" },
];

/** Ersetzt nur den geänderten Abschnitt; execCommand hält dabei Strg+Z und löst das Eingabeereignis aus. */
function applyEdit(field: HTMLTextAreaElement, edit: TextEdit): void {
  const before = field.value;
  let prefix = 0;
  while (prefix < before.length && before[prefix] === edit.text[prefix]) prefix++;
  let suffix = 0;
  const limit = Math.min(before.length, edit.text.length) - prefix;
  while (suffix < limit && before[before.length - 1 - suffix] === edit.text[edit.text.length - 1 - suffix]) suffix++;
  const insert = edit.text.slice(prefix, edit.text.length - suffix);
  field.focus();
  field.setSelectionRange(prefix, before.length - suffix);
  if (!document.execCommand(insert ? "insertText" : "delete", false, insert)) {
    field.setRangeText(insert, prefix, before.length - suffix, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.setSelectionRange(edit.start, edit.end);
}

function moveFocus(event: KeyboardEvent<HTMLElement>, field: HTMLTextAreaElement | null): void {
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (event.key === "Escape") field?.focus();
  else if (step) buttons[(current + step + buttons.length) % buttons.length]?.focus();
  else return;
  event.preventDefault();
}

/**
 * Textfeld mit Knöpfen für die Auszeichnungen aus text-format.ts. Gespeichert wird weiter der Text mit den
 * Zeichen. Die Leiste erscheint erst im Feld, damit lange Formulare und viele Positionen ruhig bleiben.
 */
export function FormattedTextarea({ onKeyDown, onInput, ...props }: Omit<ComponentProps<"textarea">, "ref">) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");

  function toggle(style: TextStyle) {
    const element = field.current;
    if (!element) return;
    const edit = toggleTextStyle(element.value, element.selectionStart, element.selectionEnd, style);
    element.focus();
    if (!edit) setStatus("An dieser Stelle lässt sich der Text nicht auszeichnen.");
    else if (element.maxLength >= 0 && edit.text.length > element.maxLength) setStatus("Dafür ist das Zeichenlimit erreicht.");
    else {
      setStatus("");
      applyEdit(element, edit);
    }
  }

  function shortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const button = BUTTONS.find((b) => b.key === event.key.toUpperCase());
    if (!button) return;
    event.preventDefault();
    toggle(button.style);
  }

  return (
    <span className="format-field">
      <textarea
        {...props}
        ref={field}
        onKeyDown={shortcut}
        onInput={(event) => {
          setStatus("");
          onInput?.(event);
        }}
      />
      <span role="toolbar" aria-label="Textformatierung" className="format-bar" onKeyDown={(event) => moveFocus(event, field.current)}>
        {BUTTONS.map((button, index) => (
          <button
            key={button.style}
            type="button"
            tabIndex={index === active ? 0 : -1}
            aria-label={button.label}
            aria-keyshortcuts={`Control+${button.key} Meta+${button.key}`}
            title={`${button.label} (Strg/⌘+${button.key})`}
            // Die Auswahl im Feld bleibt beim Klick erhalten
            onMouseDown={(event) => event.preventDefault()}
            onFocus={() => setActive(index)}
            onClick={() => toggle(button.style)}
          >
            {button.glyph}
          </button>
        ))}
      </span>
      {status && (
        <span role="alert" className="format-status">
          {status}
        </span>
      )}
    </span>
  );
}
