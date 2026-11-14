import { type MouseEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { haeltKurs, type Punkt } from "../lib/zielkurs.ts";
import { Icon, type IconName } from "./Icon.tsx";

/** Wie ein Flyout geöffnet wurde: Überfahren nimmt den Fokus nicht, Klick und Tastatur legen ihn in die Links */
export type FlyoutWeg = "zeiger" | "klick" | "tastatur";

interface NavFlyoutProps {
  label: string;
  icon: IconName;
  active?: boolean;
  /** null, wenn zu; sonst der Weg, auf dem es aufging */
  open: FlyoutWeg | null;
  onOpen: (weg: FlyoutWeg) => void;
  onClose: () => void;
  /** Zweite Zeile im Kopf, etwa die Firma, in der man bucht; per CSS (attr), damit der Text nicht doppelt im DOM steht */
  zusatz?: string | null;
  /** Optionales Auslöse-Zeichen (z. B. Avatar), ersetzt das Symbol */
  triggerContent?: ReactNode;
  children: ReactNode;
}

const RAND_ABSTAND = 12;
// Öffnen erst nach kurzem Verweilen, damit der Zeiger auf dem Weg nach unten nicht jede Gruppe aufreißt;
// Schließen mit Verzug, damit der Weg über die Lücke ins Flyout reicht (WCAG 1.4.13, „hoverable“)
const OEFFNEN_NACH = 150;
const SCHLIESSEN_NACH = 300;
// Hält der Zeiger Kurs auf ein offenes Flyout (lib/zielkurs.ts), prüft das gestreifte Symbol so oft nach
const KURS_NACHPRUEFEN = 50;
// Ohne Bewegung so lange gilt der Zeiger als stehend
const STILL_NACH = 60;

/** Die letzten Lagen der Maus, für den Zielkurs; ein Zuhörer für alle Flyouts */
const zeiger = { lagen: [] as Punkt[], zuletzt: 0, aktiv: false };
function zeigerVerfolgen() {
  if (zeiger.aktiv || typeof document === "undefined") return;
  zeiger.aktiv = true;
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return;
      zeiger.lagen = [...zeiger.lagen.slice(-3), { x: event.clientX, y: event.clientY }];
      zeiger.zuletzt = performance.now();
    },
    { passive: true },
  );
}

/** Zieht die Maus gerade auf ein anderes, offenes Flyout zu? Dann soll das Symbol unter ihr noch nicht öffnen */
function unterwegsZuAnderem(eigenes: HTMLElement | null): boolean {
  const offen = document.querySelector<HTMLElement>(".nav-flyout:not([hidden])");
  if (!offen || eigenes?.contains(offen)) return false;
  const [vorher] = zeiger.lagen;
  const jetzt = zeiger.lagen.at(-1);
  if (!vorher || !jetzt || performance.now() - zeiger.zuletzt > STILL_NACH) return false;
  return haeltKurs(vorher, jetzt, offen.getBoundingClientRect());
}

function usePanelPosition(open: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const maxTop = Math.max(RAND_ABSTAND, window.innerHeight - panel.offsetHeight - RAND_ABSTAND);
      setTop(Math.min(Math.max(RAND_ABSTAND, trigger.getBoundingClientRect().top), maxTop));
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    const navBody = triggerRef.current?.closest(".nav-body");
    navBody?.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      navBody?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);
  return { triggerRef, panelRef, top };
}

/** Schließt bei Klick oder Fokus daneben und bei Esc; legt den Fokus nur nach Klick oder Tastatur in die Links */
function useFlyoutSchliessen(
  open: FlyoutWeg | null,
  onClose: () => void,
  root: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  panelRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (open === "klick" || open === "tastatur") panelRef.current?.querySelector<HTMLElement>("a, button, select, input")?.focus({ preventScroll: true });
  }, [open, panelRef]);

  useEffect(() => {
    if (!open) return;
    let zeiger = false;
    const druck = () => {
      zeiger = true;
    };
    const daneben = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
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
      const fokusDrin = root.current?.contains(document.activeElement);
      onClose();
      if (fokusDrin) triggerRef.current?.focus();
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
  }, [open, onClose, root, triggerRef]);
}

/**
 * Gruppen-Flyout der eingeklappten Desktop-Navigation: Überfahren mit der Maus öffnet es, Klick, Enter oder
 * Leertaste ebenso (Tastatur und Touch). Es liegt direkt nach dem Knopf im DOM, sodass Tab in die Links läuft und
 * Esc den Fokus wieder auf den Knopf legt.
 */
export function NavFlyout({ label, icon, active, open, onOpen, onClose, zusatz, triggerContent, children }: NavFlyoutProps) {
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { triggerRef, panelRef, top } = usePanelPosition(open !== null);
  useFlyoutSchliessen(open, onClose, root, triggerRef, panelRef);
  useEffect(() => {
    zeigerVerfolgen();
    return () => clearTimeout(timer.current);
  }, []);
  // Geht das Flyout von außen zu (eine andere Gruppe öffnet), verfällt ein noch laufender Verzug
  useEffect(() => {
    if (open === null) clearTimeout(timer.current);
  }, [open]);

  function zeigerRein(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    if (open) return;
    const oeffnen = () => {
      if (unterwegsZuAnderem(root.current)) timer.current = setTimeout(oeffnen, KURS_NACHPRUEFEN);
      else onOpen("zeiger");
    };
    timer.current = setTimeout(oeffnen, OEFFNEN_NACH);
  }
  function zeigerRaus(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    // Nur was das Überfahren geöffnet hat, schließt das Verlassen; ein Klick heftet das Flyout an
    if (open === "zeiger") timer.current = setTimeout(onClose, SCHLIESSEN_NACH);
  }
  function klick(event: MouseEvent) {
    clearTimeout(timer.current);
    // detail 0: per Enter oder Leertaste ausgelöst
    const weg: FlyoutWeg = event.detail === 0 ? "tastatur" : "klick";
    if (open === "zeiger") onOpen(weg);
    else if (open) onClose();
    else onOpen(weg);
  }

  return (
    <div className="nav-rail-item" ref={root} onPointerEnter={zeigerRein} onPointerLeave={zeigerRaus}>
      <button
        ref={triggerRef}
        type="button"
        className="nav-link nav-rail-trigger"
        aria-expanded={open !== null}
        aria-controls={panelId}
        aria-label={label}
        data-active={active || undefined}
        onClick={klick}
      >
        {triggerContent ?? <Icon name={icon} />}
      </button>
      <div
        id={panelId}
        ref={panelRef}
        className="nav-flyout"
        role="group"
        aria-label={label}
        hidden={open === null}
        style={top !== null ? { top: `${top}px` } : undefined}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) onClose();
        }}
      >
        <div className="nav-group-label nav-flyout-title" aria-hidden="true" data-zusatz={zusatz || undefined}>
          {label}
        </div>
        <div className="nav-flyout-links">{children}</div>
      </div>
    </div>
  );
}
