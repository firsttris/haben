import { useEffect, useId, useRef, useState } from "react";
import type { Firma } from "../lib/firmen.ts";
import { Field } from "./Field.tsx";
import { Icon } from "./Icon.tsx";

/** Ab so vielen anderen Firmen bekommt die Liste ein Suchfeld */
const SUCHE_AB = 20;

/** Liste der anderen Firmen inkl. Suchfeld ab 20 Einträgen, gemeinsam für Seitenleiste und Flyout */
export function FirmaListe({ andere }: { andere: Firma[] }) {
  const [suche, setSuche] = useState("");
  const mitSuche = andere.length >= SUCHE_AB;
  const gesucht = suche.trim().toLocaleLowerCase("de");
  const treffer = gesucht ? andere.filter((firma) => firma.name.toLocaleLowerCase("de").includes(gesucht)) : andere;
  return (
    <>
      {mitSuche && (
        <Field label="Firma suchen" hideLabel className="firma-suche">
          {(control) => (
            <input {...control} type="search" placeholder="Firma suchen" autoComplete="off" value={suche} onChange={(event) => setSuche(event.target.value)} />
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
    </>
  );
}

/**
 * Firma wechseln (#504): eine Zeile der Navigation, unter der die Instanzen der anderen Firmen im Fluss aufklappen.
 * Die eigene Firma steht nicht darin, ihr Name steht unter „Haben“. Die Firmen sind Links im selben Tab, deshalb eine
 * Liste und kein `role="menu"`.
 */
export function FirmaWechsler({ andere }: { andere: Firma[] }) {
  const [open, setOpen] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const auswahl = useRef<HTMLDivElement>(null);
  const auswahlId = useId();

  function toggle() {
    setRenderKey((k) => k + 1);
    setOpen((war) => !war);
  }

  useEffect(() => {
    if (!open) return;
    // Fokus ins Suchfeld, ohne Suchfeld auf die erste Firma
    auswahl.current?.querySelector<HTMLElement>("input, a")?.focus({ preventScroll: true });
    // Klick daneben und Tab aus der Liste schließen. Der Zeiger schließt erst mit dem Klick, nicht schon beim Drücken
    // und nicht über den Fokus, den das Drücken setzt: Die Liste steht im Fluss, mit ihr rutschten die Menüpunkte
    // unter Zeiger oder Finger weg, und der Klick auf einen von ihnen ginge verloren
    let zeiger = false;
    const druck = () => {
      zeiger = true;
    };
    const daneben = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const fokus = (event: Event) => {
      if (!zeiger) daneben(event);
    };
    const taste = (event: KeyboardEvent) => {
      zeiger = false;
      if (event.key !== "Escape") return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", druck, true);
    document.addEventListener("click", daneben);
    document.addEventListener("focusin", fokus);
    window.addEventListener("keydown", taste, true);
    return () => {
      document.removeEventListener("pointerdown", druck, true);
      document.removeEventListener("click", daneben);
      document.removeEventListener("focusin", fokus);
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
        <FirmaListe key={renderKey} andere={andere} />
      </div>
    </div>
  );
}
