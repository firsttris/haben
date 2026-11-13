import { useEffect, useId, useRef, useState } from "react";
import type { Firma } from "../lib/firmen.ts";
import { Field } from "./Field.tsx";
import { Icon } from "./Icon.tsx";

/** Ab so vielen anderen Firmen bekommt die Liste ein Suchfeld */
const SUCHE_AB = 20;

/**
 * Firma wechseln (#504): eine Zeile der Navigation, unter der die Instanzen der anderen Firmen im Fluss aufklappen.
 * Die eigene Firma steht nicht darin, ihr Name steht unter „Haben“. Die Firmen sind Links im selben Tab, deshalb eine
 * Liste und kein `role="menu"`.
 */
export function FirmaWechsler({ andere }: { andere: Firma[] }) {
  const [open, setOpen] = useState(false);
  const [suche, setSuche] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const auswahl = useRef<HTMLDivElement>(null);
  const auswahlId = useId();
  const mitSuche = andere.length >= SUCHE_AB;
  const gesucht = suche.trim().toLocaleLowerCase("de");
  const treffer = gesucht ? andere.filter((firma) => firma.name.toLocaleLowerCase("de").includes(gesucht)) : andere;

  function toggle() {
    setSuche("");
    setOpen((war) => !war);
  }

  useEffect(() => {
    if (!open) return;
    // Fokus ins Suchfeld, ohne Suchfeld auf die erste Firma
    auswahl.current?.querySelector<HTMLElement>("input, a")?.focus({ preventScroll: true });
    // Klick daneben und Tab aus der Liste schließen
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
    document.addEventListener("pointerdown", daneben);
    document.addEventListener("focusin", daneben);
    window.addEventListener("keydown", taste, true);
    return () => {
      document.removeEventListener("pointerdown", daneben);
      document.removeEventListener("focusin", daneben);
      window.removeEventListener("keydown", taste, true);
    };
  }, [open]);

  return (
    <div className="firma-wechsler" ref={root}>
      <button ref={button} type="button" className="nav-link firma-wechsler-knopf" aria-expanded={open} aria-controls={auswahlId} onClick={toggle}>
        Firma wechseln
        <Icon name="chevron-down" size={16} />
      </button>
      {/* Bleibt im Dokument, damit aria-controls immer ein Ziel hat */}
      <div ref={auswahl} id={auswahlId} role="group" aria-label="Firma wechseln" hidden={!open}>
        {mitSuche && (
          <Field label="Firma suchen" hideLabel className="firma-suche">
            {(control) => (
              <input
                {...control}
                type="search"
                placeholder="Firma suchen"
                autoComplete="off"
                value={suche}
                onChange={(event) => setSuche(event.target.value)}
              />
            )}
          </Field>
        )}
        <ul className="firma-liste">
          {treffer.map((firma) => (
            <li key={firma.url}>
              <a href={firma.url} className="nav-link">
                {firma.name}
              </a>
            </li>
          ))}
        </ul>
        {mitSuche && (
          <p className="firma-leer" role="status">
            {treffer.length === 0 ? "Keine Firma gefunden." : ""}
          </p>
        )}
      </div>
    </div>
  );
}
