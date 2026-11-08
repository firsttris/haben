import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type PreviewMode, previewLayout, readPreviewMode, writePreviewMode } from "../lib/vorschau.ts";
import { Icon } from "./Icon.tsx";

/**
 * Eine Vorschau-Hülle für alle Belegeditoren (#357): Der Split-Button „Vorschau“ im Seitenkopf öffnet die Überblendung
 * oder heftet die Vorschau neben das Formular. Das Formular wird dabei nie neu aufgebaut, Eingaben und Scrollposition
 * bleiben. Die Vorschau selbst steht nur im Dokument, wenn sie zu sehen ist; ausgeblendet rechnet sie nicht mit.
 */
export type DocumentPreview = {
  /** An den Container aus Formular und Vorschau: Seine Breite entscheidet, ob Anheften geht */
  layoutRef: RefObject<HTMLDivElement | null>;
  /** Hauptknopf „Vorschau“: Dorthin kehrt der Fokus zurück, wenn die angeheftete Vorschau verschwindet */
  triggerRef: RefObject<HTMLButtonElement | null>;
  canPin: boolean;
  pinned: boolean;
  /** Die angeheftete Vorschau fährt gerade; nur auf Zuruf, beim Laden und beim Ändern der Fenstergröße steht sie einfach da */
  paneMotion: PaneMotion;
  paneSettled: () => void;
  overlayOpen: boolean;
  /** Zählt jedes Öffnen: Wer klickt, während die Leiste noch hinausfährt, bekommt eine neue, statt ins Leere zu klicken */
  overlayRun: number;
  openOverlay: () => void;
  closeOverlay: () => void;
  pin: () => void;
  unpin: () => void;
};

type PaneMotion = "in" | "out" | null;

export function useDocumentPreview(): DocumentPreview {
  const layoutRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [stored, setStored] = useState<PreviewMode | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayRun, setOverlayRun] = useState(0);
  const [paneMotion, setPaneMotion] = useState<PaneMotion>(null);

  // Erst im Browser: localStorage und die Breite gibt es auf dem Server nicht
  useEffect(() => setStored(readPreviewMode(browserStorage())), []);
  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const resize = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? layout.clientWidth));
    resize.observe(layout);
    return () => resize.disconnect();
  }, []);

  const { canPin, pinned } = previewLayout(stored, width);

  // Falls das Ende der Fahrt nie gemeldet wird (Tab im Hintergrund), steht sonst dauerhaft eine leere Spalte da
  useEffect(() => {
    if (!paneMotion) return;
    const settle = window.setTimeout(() => setPaneMotion(null), 500);
    return () => window.clearTimeout(settle);
  }, [paneMotion]);

  const choose = useCallback((mode: PreviewMode) => {
    setStored(mode);
    writePreviewMode(browserStorage(), mode);
  }, []);

  return {
    layoutRef,
    triggerRef,
    canPin,
    pinned,
    paneMotion,
    paneSettled: () => setPaneMotion(null),
    overlayOpen,
    overlayRun,
    openOverlay: () => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
      setOverlayRun((run) => run + 1);
      setOverlayOpen(true);
    },
    closeOverlay: () => {
      setOverlayOpen(false);
      // Zurück auf den Auslöser, ohne dass die Seite dorthin springt (er steht im festen Kopf oder in der Vorschau)
      (returnFocus.current?.isConnected ? returnFocus.current : triggerRef.current)?.focus({ preventScroll: true });
    },
    pin: () => {
      setPaneMotion("in");
      choose("angeheftet");
    },
    unpin: () => {
      if (pinned && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPaneMotion("out");
      choose("ueberblendung");
      triggerRef.current?.focus({ preventScroll: true });
    },
  };
}

/** Container für Formular (children) und Vorschau (sheet); angeheftet zwei Spalten, sonst hat das Formular die volle Breite */
export function PreviewLayout({
  preview,
  label,
  caption,
  sheet,
  children,
}: {
  preview: DocumentPreview;
  label: string;
  caption: ReactNode;
  sheet: ReactNode;
  children: ReactNode;
}) {
  // Hinausfahrend bleibt die Spalte bis zum Schluss: So springt das Formular einmal auf volle Breite, statt mitzufließen
  const leaving = preview.paneMotion === "out";
  const showPane = preview.pinned || leaving;
  return (
    <div ref={preview.layoutRef} className="preview-layout" data-pinned={showPane || undefined}>
      {children}
      {showPane && (
        <section
          className="preview-pane"
          aria-label={label}
          data-motion={preview.paneMotion ?? undefined}
          inert={leaving}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget) preview.paneSettled();
          }}
        >
          <div className="preview-pane-head">
            <span className="small muted">{caption}</span>
            <div className="preview-pane-actions">
              <button type="button" className="btn btn-sm" aria-haspopup="dialog" onClick={preview.openOverlay}>
                <Icon name="expand" size={16} />
                Vergrößern
              </button>
              <button type="button" className="btn btn-sm" onClick={preview.unpin}>
                <Icon name="close" size={16} />
                Ausblenden
              </button>
            </div>
          </div>
          <SheetScroll className="preview-pane-body">{sheet}</SheetScroll>
        </section>
      )}
      {preview.overlayOpen && (
        <PreviewDialog key={preview.overlayRun} label={label} caption={caption} onClose={preview.closeOverlay}>
          {sheet}
        </PreviewDialog>
      )}
    </div>
  );
}

/**
 * Modaler <dialog> als Seitenleiste, die von rechts hereinfährt: hält den Fokus, Escape und ein Klick neben das Blatt
 * schließen ihn. Er bleibt im Dokument, bis er hinausgefahren ist; ohne Bewegung (prefers-reduced-motion) sofort weg.
 */
function PreviewDialog({ label, caption, onClose, children }: { label: string; caption: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const replaced = useRef(false);
  const pressedBeside = useRef(false);

  useEffect(() => {
    replaced.current = false;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      replaced.current = true;
    };
  }, []);

  const closed = () => {
    const dialog = ref.current;
    if (!dialog || parseFloat(getComputedStyle(dialog).transitionDuration) === 0) return onClose();
    let done = false;
    const finish = () => {
      if (done || replaced.current) return;
      done = true;
      onClose();
    };
    dialog.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, 500);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={ref}
      className="preview-dialog"
      aria-labelledby={titleId}
      onClose={closed}
      onPointerDown={(e) => {
        pressedBeside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Nur was daneben begann: Eine Textauswahl, die dort endet, meldet der Browser ebenfalls am Dialog
        if (e.target === e.currentTarget && pressedBeside.current) e.currentTarget.close();
      }}
    >
      <div className="preview-dialog-head">
        <div>
          <h2 id={titleId}>{label}</h2>
          <span className="small muted">{caption}</span>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => ref.current?.close()}>
          <Icon name="close" size={16} />
          Schließen
        </button>
      </div>
      <SheetScroll className="preview-dialog-body">{children}</SheetScroll>
    </dialog>,
    document.body,
  );
}

/**
 * Split-Button nach dem Muster „Menu Button“ der WAI-ARIA APG: Hauptaktion und Pfeil sind getrennt fokussierbar, das
 * Menü öffnet mit Enter, Leertaste oder Pfeil und hält den Fokus in seinen Einträgen. Ohne Platz zum Anheften (Handy,
 * schmales Fenster) entfällt der Pfeil.
 */
export function PreviewButton({ preview }: { preview: DocumentPreview }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hintId = useId();

  const closeMenu = (focusArrow: boolean) => {
    setMenuOpen(false);
    if (focusArrow) arrow.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    menuItems(menu.current)[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!group.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  // Wird das Fenster schmal, während das Menü offen ist, verschwindet der Pfeil mit ihm
  useEffect(() => {
    if (!preview.canPin) setMenuOpen(false);
  }, [preview.canPin]);

  const main = (
    <button
      ref={preview.triggerRef}
      type="button"
      className="btn"
      aria-haspopup="dialog"
      onClick={() => {
        setMenuOpen(false);
        preview.openOverlay();
      }}
    >
      <Icon name="eye" size={16} />
      Vorschau
    </button>
  );
  if (!preview.canPin) return main;

  const onArrowKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setMenuOpen(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = menuItems(menu.current);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "Tab") setMenuOpen(false);
  };

  const toggle = () => {
    closeMenu(true);
    if (preview.pinned) preview.unpin();
    else preview.pin();
  };

  return (
    <div ref={group} className="split-btn" role="group" aria-label="Vorschau">
      {main}
      <button
        ref={arrow}
        type="button"
        className="btn split-btn-arrow"
        aria-label="Weitere Vorschau-Optionen"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={onArrowKey}
      >
        <Icon name="chevron-down" size={16} />
      </button>
      {menuOpen && (
        <div ref={menu} id={menuId} role="menu" aria-label="Vorschau" className="split-menu" onKeyDown={onMenuKey}>
          <button type="button" role="menuitem" tabIndex={-1} aria-describedby={hintId} onClick={toggle}>
            <Icon name={preview.pinned ? "eye-off" : "pin"} />
            <span className="split-menu-text">
              <span>{preview.pinned ? "Vorschau abheften" : "Neben Formular anheften"}</span>
              <span id={hintId} className="small muted">
                {preview.pinned ? "Formular wieder in voller Breite" : "Formular und Vorschau nebeneinander"}
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Bereich, in dem das Blatt scrollt. Ist es höher als der Bereich, nimmt er den Fokus an, damit es sich mit den
 * Pfeiltasten scrollen lässt (WCAG 2.1.1, axe „scrollable-region-focusable“); passt es, bleibt er aus der Tab-Reihenfolge.
 * An der Kante, hinter der es weitergeht, läuft das Blatt in einem Verlauf aus; der Rahmen darum bleibt stehen.
 */
function SheetScroll({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const { paddingTop, paddingBottom } = getComputedStyle(element);
    const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
    setScrolls(element.scrollHeight > element.clientHeight + 1);
    // Direkt am Rahmen statt über den Zustand: Das läuft bei jedem Scrollschritt
    element.parentElement?.style.setProperty("--fade-top", fadeStrength(element.scrollTop, parseFloat(paddingTop)));
    element.parentElement?.style.setProperty("--fade-bottom", fadeStrength(remaining, parseFloat(paddingBottom)));
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    // Auch das Blatt beobachten: Es wächst mit jeder Position, der Bereich selbst bleibt gleich hoch
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="sheet-frame">
      <div
        ref={ref}
        className={className}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? "region" : undefined}
        aria-label={scrolls ? "Blatt der Vorschau" : undefined}
        onScroll={measure}
      >
        {children}
      </div>
    </div>
  );
}

/** Der Verlauf ist voll, sobald die Blattkante den Rand des Bereichs erreicht, und wächst über den Innenabstand davor */
function fadeStrength(distance: number, padding: number): string {
  return distance <= 1 ? "0" : String(Math.min(distance / Math.max(padding, 1), 1));
}

/** Chrome mit gesperrten Websitedaten wirft schon beim Zugriff auf window.localStorage; dann gilt die Wahl bis zum Neuladen */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
}
