import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import type { Firma } from "../lib/firmen.ts";
import { Field } from "./Field.tsx";
import { Icon } from "./Icon.tsx";

/** Ab so vielen anderen Firmen bekommt die Liste ein Filterfeld */
const FILTER_AB = 8;

/**
 * Firma wechseln (#504): Knopf mit Pfeil am Firmennamen der Marke, der die Instanzen der anderen Firmen zeigt. Am
 * Desktop schwebt die Liste neben der Navigation (`position: fixed`, weil die Navigation selbst scrollt und sie sonst
 * abschnitte), am Handy klappt sie im geöffneten Menü als Abschnitt auf. Die Firmen sind Links im selben Tab, deshalb
 * eine Liste und kein `role="menu"`.
 */
export function FirmaWechsler({ aktuell, andere }: { aktuell: string | null; andere: Firma[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [top, setTop] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const mitFilter = andere.length >= FILTER_AB;
  const gesucht = filter.trim().toLocaleLowerCase("de");
  const treffer = gesucht ? andere.filter((firma) => firma.name.toLocaleLowerCase("de").includes(gesucht)) : andere;

  function toggle() {
    // Die schwebende Liste beginnt unter dem Knopf; am Handy steht sie im Fluss und braucht den Wert nicht
    setTop((button.current?.getBoundingClientRect().bottom ?? 0) + 4);
    setFilter("");
    setOpen((war) => !war);
  }

  useEffect(() => {
    if (!open) return;
    // Fokus ins Filterfeld, ohne Filter auf die erste Firma
    popup.current?.querySelector<HTMLElement>("input, a")?.focus({ preventScroll: true });
    const schwebt = window.matchMedia("(min-width: 861px)").matches;
    const daneben = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const taste = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    // Rollt die Navigation oder die Seite, stünde die schwebende Liste nicht mehr am Knopf
    const rollt = (event: Event) => {
      if (schwebt && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const zu = () => setOpen(false);
    document.addEventListener("pointerdown", daneben);
    document.addEventListener("focusin", daneben);
    window.addEventListener("keydown", taste, true);
    window.addEventListener("scroll", rollt, true);
    window.addEventListener("resize", zu);
    return () => {
      document.removeEventListener("pointerdown", daneben);
      document.removeEventListener("focusin", daneben);
      window.removeEventListener("keydown", taste, true);
      window.removeEventListener("scroll", rollt, true);
      window.removeEventListener("resize", zu);
    };
  }, [open]);

  return (
    <div className="firma-wechsler" ref={root}>
      <button ref={button} type="button" className="firma-wechsler-knopf" aria-expanded={open} aria-controls={popupId} onClick={toggle}>
        <span className="firma-wechsler-text">Firma wechseln</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {/* Bleibt im Dokument, damit aria-controls immer ein Ziel hat */}
      <div
        ref={popup}
        id={popupId}
        className="firma-popup"
        role="group"
        aria-label="Firma wechseln"
        hidden={!open}
        style={{ "--firma-top": `${top}px` } as CSSProperties}
      >
        {aktuell && (
          <div className="firma-aktuell">
            <Icon name="check" size={16} />
            <span>
              <span className="visually-hidden">Aktuelle Firma: </span>
              {aktuell}
            </span>
          </div>
        )}
        {mitFilter && (
          <Field label="Firma suchen" hideLabel className="firma-filter">
            {(control) => (
              <input
                {...control}
                type="search"
                placeholder="Firma suchen"
                autoComplete="off"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            )}
          </Field>
        )}
        <ul className="firma-liste">
          {treffer.map((firma) => (
            <li key={firma.url}>
              <a href={firma.url} onClick={() => setOpen(false)}>
                {firma.name}
              </a>
            </li>
          ))}
        </ul>
        {mitFilter && (
          <p className="firma-leer" role="status">
            {treffer.length === 0 ? "Keine Firma gefunden." : ""}
          </p>
        )}
      </div>
    </div>
  );
}
