import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.tsx";

interface NavFlyoutProps {
  label: string;
  icon: IconName;
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Optionales Auslöse-Zeichen (z. B. Avatar), ersetzt das Symbol */
  triggerContent?: ReactNode;
  children: ReactNode;
}

const RAND_ABSTAND = 12;

/**
 * Gruppen-Flyout für die eingeklappte Desktop-Navigation: der Auslöser öffnet per Klick, Enter oder Leertaste ein
 * schwebendes Panel neben der schmalen Leiste. Es liegt direkt nach dem Knopf im DOM, sodass Tab in die Links läuft
 * und Esc den Fokus wieder auf den Knopf legt.
 */
export function NavFlyout({ label, icon, active, open, onToggle, onClose, triggerContent, children }: NavFlyoutProps) {
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelHeight = panel.offsetHeight;
      const maxTop = Math.max(RAND_ABSTAND, window.innerHeight - panelHeight - RAND_ABSTAND);
      setTop(Math.min(Math.max(RAND_ABSTAND, triggerRect.top), maxTop));
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    const nav = triggerRef.current?.closest(".nav");
    nav?.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      nav?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button, select, input")?.focus({ preventScroll: true });
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
      onClose();
      triggerRef.current?.focus();
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
  }, [open, onClose]);

  return (
    <div className="nav-rail-item" ref={root}>
      <button
        ref={triggerRef}
        type="button"
        className="nav-link nav-rail-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        data-active={active || undefined}
        onClick={onToggle}
      >
        {triggerContent ?? <Icon name={icon} />}
      </button>
      <div
        id={panelId}
        ref={panelRef}
        className="nav-flyout"
        role="group"
        aria-label={label}
        hidden={!open}
        style={top !== null ? { top: `${top}px` } : undefined}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) onClose();
        }}
      >
        <div className="nav-flyout-title">{label}</div>
        <div className="nav-flyout-links">{children}</div>
      </div>
    </div>
  );
}
