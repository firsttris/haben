import { MONTHS } from "@haben/core";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { formatMonthLabel, formatMonthValue, initialViewYear, isMonthDisabled, MONTH_SHORT, yearBounds } from "../lib/month-picker.ts";
import { Icon } from "./Icon.tsx";

export interface MonthPickerProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Von `Field`: Hinweis und Fehler gehören an den Auslöser */
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | undefined;
}

/**
 * Einheitliche Monatsauswahl (JJJJ-MM) mit Jahreswechsel und 3×4-Monatsraster;
 * ersetzt `<input type="month">`, das Firefox nur als Textfeld zeigt.
 */
export function MonthPicker({
  id,
  name,
  value,
  onChange,
  min,
  max,
  disabled = false,
  placeholder = "Monat wählen",
  ariaLabel,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => initialViewYear(value, min, max));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = formatMonthLabel(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openPopup() {
    setViewYear(initialViewYear(value, min, max));
    setOpen(true);
  }

  function closePopup(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      openPopup();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closePopup(true);
    }
  }

  return (
    <div className="month-picker" ref={rootRef}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className="month-picker-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closePopup() : openPopup())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={label ? undefined : "month-picker-placeholder"}>{label || placeholder}</span>
        <Icon name="calendar" size={16} />
      </button>
      {open && (
        <MonthPopup
          value={value}
          viewYear={viewYear}
          min={min}
          max={max}
          onYearChange={setViewYear}
          onPick={(ym) => {
            onChange(ym);
            closePopup(true);
          }}
          onClose={() => closePopup(true)}
        />
      )}
    </div>
  );
}

function MonthPopup({
  value,
  viewYear,
  min,
  max,
  onYearChange,
  onPick,
  onClose,
}: {
  value: string;
  viewYear: number;
  min?: string;
  max?: string;
  onYearChange: (year: number) => void;
  onPick: (ym: string) => void;
  onClose: () => void;
}) {
  const { minYear, maxYear } = yearBounds(min, max);
  return (
    <div
      role="dialog"
      aria-label="Monat wählen"
      className="month-picker-popup"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="month-picker-header">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Vorheriges Jahr"
          disabled={minYear !== undefined && viewYear <= minYear}
          onClick={() => onYearChange(viewYear - 1)}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="month-picker-year">{viewYear}</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Nächstes Jahr"
          disabled={maxYear !== undefined && viewYear >= maxYear}
          onClick={() => onYearChange(viewYear + 1)}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <div className="month-picker-grid">
        {MONTHS.map((fullName, index) => {
          const ym = formatMonthValue(viewYear, index + 1);
          const selected = ym === value;
          return (
            <button
              key={ym}
              type="button"
              className={selected ? "month-picker-cell active" : "month-picker-cell"}
              aria-label={`${fullName} ${viewYear}`}
              aria-pressed={selected}
              disabled={isMonthDisabled(ym, min, max)}
              onClick={() => onPick(ym)}
            >
              {MONTH_SHORT[index]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
