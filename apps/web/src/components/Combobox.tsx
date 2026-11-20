import { useId, useRef, useState, type KeyboardEvent } from "react";
import { defaultRow, listKey, type SearchResult } from "../lib/combobox.ts";
import { Icon } from "./Icon.tsx";

export interface ComboboxOption {
  key: string;
  label: string;
  /** Zweite Zeile, etwa Nummer und Ort */
  meta?: string;
  selected?: boolean;
}

/** Letzte Zeile der Liste: etwas Neues anlegen */
export interface ComboboxCreate {
  label: string;
  run: () => void;
}

/** id einer Zeile der Liste, für aria-activedescendant */
const optionId = (listId: string, row: number) => `${listId}-${row}`;

/**
 * Eingabefeld mit Trefferliste nach dem WAI-ARIA-Muster „Editable Combobox With List Autocomplete“
 * (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): Der Fokus bleibt im Feld, aria-activedescendant zeigt den
 * Eintrag. Pfeile bewegen, Enter übernimmt, Escape schließt.
 *
 * Ein Klick zeigt die Liste. Zwei Arten: Ohne freeText ist es eine Auswahl, der erste Treffer einer Suche ist aktiv. Mit freeText
 * bleibt der getippte Text gültig; ein Eintrag zählt nur, wenn er gewählt wird. Tab übernimmt nur mit commitOnTab: wo die
 * Auswahl ein Feld füllt, nicht wo sie etwas auslöst wie eine neue Position.
 *
 * Gesucht wird nur bei offener Liste (search), denn der Editor rendert bei jedem Tastendruck alle Positionen neu.
 */
export function Combobox<T>({
  id,
  label,
  value,
  onInput,
  search,
  describe,
  onPick,
  create,
  freeText = false,
  commitOnTab = false,
  placeholder,
  disabled = false,
  required = false,
  "aria-describedby": describedBy,
  "aria-invalid": invalid = false,
  className = "",
  onBlur,
  onKeyDown: afterKey,
}: {
  id?: string;
  /** Zugänglicher Name, wenn kein <label htmlFor> zum Feld gehört */
  label?: string;
  value: string;
  onInput: (text: string) => void;
  search: () => SearchResult<T>;
  describe: (item: T) => ComboboxOption;
  onPick: (item: T) => void;
  create?: ComboboxCreate | null;
  freeText?: boolean;
  commitOnTab?: boolean;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: boolean | undefined;
  className?: string;
  onBlur?: () => void;
  /** Taste, die die Liste nicht selbst verbraucht hat, etwa Enter bei geschlossener Liste, bevor es das Formular abschickt */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  /** Mit den Pfeilen gewählte Zeile; null = die Vorgabe. Die Maus zeigt ihre Zeile nur per :hover, sonst rendert jede Zeile das Feld neu */
  const [moved, setMoved] = useState<number | null>(null);
  /** Seit dem Öffnen der Liste getippt */
  const [typed, setTyped] = useState(false);
  /** Der Klick kam aus dem Feld selbst; ein Klick auf das Label wird als Klick aufs Feld weitergereicht und soll nur fokussieren */
  const pressedInField = useRef(false);

  const { hits, total } = open ? search() : { hits: [] as T[], total: 0 };
  const options = hits.map(describe);
  const createRow = open && create ? create : null;
  const createIndex = createRow ? options.length : -1;
  const rows = options.length + (createRow ? 1 : 0);
  const selectedRow = options.findIndex((option) => option.selected);
  const firstRow = defaultRow({ freeText, typed, text: value, selectedRow, rows });
  const active = Math.min(moved ?? firstRow, rows - 1);
  // Bei freier Eingabe ohne Zeilen (noch kein Artikel im Katalog) gibt es nichts zu zeigen
  const popup = open && (rows > 0 || !freeText);
  const expanded = open && rows > 0;
  const rowId = (row: number) => optionId(listId, row);

  function close() {
    setOpen(false);
    setMoved(null);
    setTyped(false);
  }

  function commit(row: number) {
    close();
    if (row === createIndex) createRow?.run();
    else onPick(hits[row]!);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const step = listKey(event.key, event.altKey, { open, active, rows, createIndex, commitOnTab });
    if (step?.prevent) event.preventDefault();
    if (step?.stop) event.stopPropagation();
    if (step?.action === "open") setOpen(true);
    else if (step?.action === "close") close();
    else if (step?.action === "commit") commit(step.row);
    else if (step?.action === "move") {
      setMoved(step.row);
      document.getElementById(rowId(step.row))?.scrollIntoView({ block: "nearest" });
    }
    if (!event.defaultPrevented) afterKey?.(event);
  }

  return (
    <div className={`combobox${className ? ` ${className}` : ""}`}>
      <input
        id={id}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? rowId(active) : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(event) => {
          const text = event.target.value;
          onInput(text);
          setMoved(null);
          setTyped(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onMouseDown={() => {
          pressedInField.current = true;
        }}
        onClick={(event) => {
          const pressed = pressedInField.current;
          pressedInField.current = false;
          if (open || !pressed) return;
          setOpen(true);
          // Im Klick, nicht beim Fokus: Sonst setzt der Browser die Einfügemarke gleich wieder und die Markierung ist weg.
          // Freier Text bleibt unmarkiert, ein Klick dort heißt meist: an dieser Stelle weiterschreiben
          if (!freeText) event.currentTarget.select();
        }}
        onBlur={() => {
          close();
          onBlur?.();
        }}
      />
      {popup && (
        <ComboboxPopup listId={listId} options={options} createRow={createRow} createIndex={createIndex} active={active} total={total} commit={commit} />
      )}
    </div>
  );
}

/** Die aufgeklappte Liste: Treffer, die Zeile zum Anlegen, Hinweise und die Ansage der Trefferzahl */
function ComboboxPopup({
  listId,
  options,
  createRow,
  createIndex,
  active,
  total,
  commit,
}: {
  listId: string;
  /** Die gezeigten Treffer, höchstens total */
  options: ComboboxOption[];
  createRow: ComboboxCreate | null;
  createIndex: number;
  active: number;
  total: number;
  commit: (row: number) => void;
}) {
  const rowId = (row: number) => optionId(listId, row);
  return (
    // Ein Klick in die Liste nimmt dem Feld nicht den Fokus, sonst schlösse sie vor dem Klick
    <div className="combobox-popup" onMouseDown={(event) => event.preventDefault()}>
      {options.length > 0 || createRow ? (
        <div id={listId} role="listbox" aria-label="Treffer">
          {options.map((option, row) => (
            <div
              key={option.key}
              id={rowId(row)}
              role="option"
              tabIndex={-1}
              aria-selected={option.selected === true}
              className={row === active ? "combobox-option active" : "combobox-option"}
              onClick={() => commit(row)}
            >
              <span>{option.label}</span>
              {option.meta && <span className="combobox-meta">{option.meta}</span>}
            </div>
          ))}
          {createRow && (
            <div
              id={rowId(createIndex)}
              role="option"
              tabIndex={-1}
              aria-selected={false}
              className={active === createIndex ? "combobox-option combobox-create active" : "combobox-option combobox-create"}
              onClick={() => commit(createIndex)}
            >
              <Icon name="plus" size={16} />
              <span>{createRow.label}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="combobox-note">Keine Treffer</p>
      )}
      {total > options.length && (
        <p className="combobox-note">
          {options.length} von {total} Treffern. Weiter tippen grenzt die Liste ein.
        </p>
      )}
      <span role="status" className="visually-hidden">
        {total === 1 ? "1 Treffer" : `${total} Treffer`}
      </span>
    </div>
  );
}
