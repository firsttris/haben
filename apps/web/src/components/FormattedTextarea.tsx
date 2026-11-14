import { type ComponentProps, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { type TextEdit, type TextStyle, toggleTextStyle } from "@haben/core";
import { caretPosition } from "../lib/textarea-caret.ts";
import { ariaKuerzel, kuerzelText, useApple } from "../lib/tastatur.ts";

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

const BAR_HEIGHT = 34;
const BAR_WIDTH = 96;
const GAP = 6;

interface Anchor {
  left: number;
  top: number;
}

/**
 * Am Mauszeiger: über dem Anfang der Auswahl, wie in anderen Programmen. Auf Touchgeräten rechts über dem
 * Feld, denn dort legt iOS sein Menü (Kopieren, Einfügen) über oder unter die Auswahl, und unter ihr
 * verdeckt die Tastaturleiste die Knöpfe (im iOS-Simulator geprüft).
 */
function selectionAnchor(field: HTMLTextAreaElement): Anchor | null {
  if (field.selectionStart === field.selectionEnd) return null;
  const inView = Math.max(-BAR_HEIGHT - GAP, scrollAreaTop(field) + GAP);
  if (window.matchMedia("(pointer: coarse)").matches) {
    const visibleTop = (window.visualViewport?.offsetTop ?? 0) - field.getBoundingClientRect().top + GAP;
    return { left: field.offsetWidth, top: Math.max(inView, visibleTop) };
  }
  const caret = caretPosition(field, field.selectionStart);
  // Liegt die Stelle außerhalb des gescrollten Felds, bleibt die Leiste am Feldrand
  return { left: caret.left, top: Math.min(Math.max(caret.top - BAR_HEIGHT - GAP, inView), field.offsetHeight + GAP) };
}

/** Oberkante des scrollenden Bereichs um das Feld (das Formular im Dialog), vom Feld aus gemessen: Darüber wäre die Leiste abgeschnitten. */
function scrollAreaTop(field: HTMLElement): number {
  for (let parent = field.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent.getBoundingClientRect().top - field.getBoundingClientRect().top;
  }
  return Number.NEGATIVE_INFINITY;
}

function moveFocus(event: KeyboardEvent<HTMLElement>, onEscape: () => void): void {
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (event.key === "Escape") onEscape();
  else if (step) buttons[(current + step + buttons.length) % buttons.length]?.focus();
  else return;
  event.preventDefault();
}

/**
 * Textfeld mit Knöpfen für die Auszeichnungen aus text-format.ts. Gespeichert wird weiter der Text mit den
 * Zeichen. Die Leiste erscheint an der Markierung, damit lange Formulare und viele Positionen ruhig bleiben.
 */
export function FormattedTextarea({
  onKeyDown,
  onInput,
  onFocus,
  "aria-describedby": describedBy,
  fieldRef,
  ...props
}: Omit<ComponentProps<"textarea">, "ref"> & { fieldRef?: (element: HTMLTextAreaElement | null) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const dismissed = useRef<string | null>(null);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const hintId = useId();
  const apple = useApple();

  const syncAnchor = useCallback(() => {
    const element = field.current;
    if (!element || document.activeElement !== element) return;
    // Mit Esc geschlossen bleibt die Leiste zu, bis sich die Auswahl ändert
    if (dismissed.current === `${element.selectionStart}:${element.selectionEnd}`) return;
    dismissed.current = null;
    setAnchor(selectionAnchor(element));
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", syncAnchor);
    window.addEventListener("resize", syncAnchor);
    return () => {
      document.removeEventListener("selectionchange", syncAnchor);
      window.removeEventListener("resize", syncAnchor);
    };
  }, [syncAnchor]);

  function dismiss(element: HTMLTextAreaElement) {
    dismissed.current = `${element.selectionStart}:${element.selectionEnd}`;
    setAnchor(null);
  }

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
      syncAnchor();
    }
  }

  function shortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.key === "Escape" && anchor) {
      dismiss(event.currentTarget);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const button = BUTTONS.find((b) => b.key === event.key.toUpperCase());
    if (!button) return;
    event.preventDefault();
    toggle(button.style);
  }

  return (
    <span
      className="format-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setAnchor(null);
      }}
    >
      <textarea
        {...props}
        ref={(element) => {
          field.current = element;
          fieldRef?.(element);
        }}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
        onKeyDown={shortcut}
        onSelect={syncAnchor}
        onScroll={syncAnchor}
        onFocus={(event) => {
          syncAnchor();
          onFocus?.(event);
        }}
        onInput={(event) => {
          setStatus("");
          onInput?.(event);
        }}
      />
      <span id={hintId} className="visually-hidden">
        Text markieren, dann erscheinen Knöpfe zum Auszeichnen. Oder {kuerzelText(["mod"], apple)} mit B, I oder U.
      </span>
      {anchor && (
        <span
          role="toolbar"
          aria-label="Textformatierung"
          className="format-bar"
          style={{ left: `min(${anchor.left}px, calc(100% - ${BAR_WIDTH}px))`, top: anchor.top }}
          // Die Auswahl im Feld bleibt beim Klick erhalten, auch knapp neben einem Knopf
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) =>
            moveFocus(event, () => {
              if (!field.current) return;
              dismiss(field.current);
              field.current.focus();
            })
          }
        >
          {BUTTONS.map((button, index) => (
            <button
              key={button.style}
              type="button"
              tabIndex={index === active ? 0 : -1}
              aria-label={button.label}
              aria-keyshortcuts={ariaKuerzel(["mod", button.key])}
              title={`${button.label} (${kuerzelText(["mod", button.key], apple)})`}
              onFocus={() => setActive(index)}
              onClick={() => toggle(button.style)}
            >
              {button.glyph}
            </button>
          ))}
        </span>
      )}
      {status && (
        <span role="alert" className="format-status">
          {status}
        </span>
      )}
    </span>
  );
}
