import { type PointerEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Eine Zeile über den Folgen; `strong` hebt den Betrag hervor */
export type ConfirmFact = { label: string; value: string; strong?: boolean };

type ConfirmDialogProps = {
  open: boolean;
  /** Eine Frage mit dem Objekt: „Rechnung 2026-001 festschreiben?“ */
  title: string;
  /** Der Name der Aktion, nie „OK“ */
  confirmLabel: string;
  /** Löschen, Stornieren, Entfernen und alles, was sich nicht zurückholen lässt, in Rot */
  danger?: boolean;
  /** Der Dialog schließt vor dem Aufruf; das Ergebnis meldet die Seite, nicht der Dialog */
  onConfirm: () => void;
  /** Esc, „Abbrechen“ und das Schließen nach dem Bestätigen */
  onClose: () => void;
  /** Wo es um Geld oder das Finanzamt geht: was gerade bestätigt wird */
  facts?: readonly ConfirmFact[];
  /** Nur für das Seltenste und Endgültigste: Text eines Häkchens, ohne das die Aktion gesperrt bleibt */
  acknowledge?: string;
  /** Die Folgen, als ein oder mehrere Absätze */
  children: ReactNode;
};

/** Steht ein modaler Dialog offen, gehen Tastenkürzel und Wischgesten der Seite ihn nichts an */
export function isDialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/** Die bestätigte Aktion sperrt den Auslöser, solange sie läuft; einen gesperrten Knopf kann niemand fokussieren */
function returnFocus(trigger: HTMLElement) {
  if (!trigger.matches(":disabled")) {
    trigger.focus();
    return;
  }
  const observer = new MutationObserver(() => {
    if (trigger.matches(":disabled")) return;
    observer.disconnect();
    // Hat die Seite den Fokus inzwischen selbst gesetzt, etwa nach einem Seitenwechsel, bleibt er dort
    if (document.activeElement === document.body) trigger.focus();
  });
  observer.observe(trigger, { attributes: true, attributeFilter: ["disabled"] });
}

/** Wie die Breite in styles.css, ab der der Dialog ein Blatt von unten ist */
const SHEET_MEDIA = "(max-width: 640px)";
const SWIPE_CLOSE_PX = 80;

/** Am Handy zieht man das Blatt an Griff oder Titel nach unten weg; das wirkt wie „Abbrechen“, der Knopf bleibt die Alternative ohne Geste */
function useSwipeToClose(sheet: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const startY = useRef<number | null>(null);
  const distance = (event: PointerEvent) => Math.max(0, event.clientY - (startY.current ?? event.clientY));
  const reset = () => {
    startY.current = null;
    if (sheet.current) sheet.current.style.translate = "";
  };
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!window.matchMedia(SHEET_MEDIA).matches) return;
      startY.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent) {
      if (startY.current !== null && sheet.current) sheet.current.style.translate = `0 ${distance(event)}px`;
    },
    onPointerUp(event: PointerEvent) {
      if (startY.current === null) return;
      const farEnough = distance(event) >= SWIPE_CLOSE_PX;
      reset();
      if (farEnough) onClose();
    },
    onPointerCancel: reset,
  };
}

/**
 * Rückfrage vor einer folgenreichen Aktion (#404). Ein modaler <dialog> am body wie ContactDialog: Er sperrt die
 * Seite, sodass ein Doppelklick auf den Auslöser nichts ausführen kann. Geschlossen steht er nicht im Dokument.
 */
export function ConfirmDialog({ open, ...props }: ConfirmDialogProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<OpenConfirmDialog {...props} />, document.body);
}

function OpenConfirmDialog({ title, confirmLabel, danger = false, onConfirm, onClose, facts, acknowledge, children }: Omit<ConfirmDialogProps, "open">) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const swipe = useSwipeToClose(dialog, onClose);

  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.showModal();
    // Fokus auf der Aktion mit den geringsten Folgen (WAI-ARIA APG, Dialog); React setzt autoFocus vor showModal, das zählt nicht
    cancel.current?.focus();
    // Der Dialog verschwindet aus dem Dokument, ohne close(): Dann gibt der Browser den Fokus nicht von selbst zurück
    return () => {
      if (trigger instanceof HTMLElement) returnFocus(trigger);
    };
  }, []);

  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={bodyId} onClose={onClose}>
      <div className="confirm-dialog-grip" aria-hidden="true" {...swipe} />
      <h2 id={titleId} {...swipe}>
        {title}
      </h2>
      <div id={bodyId} className="confirm-dialog-body">
        {facts && (
          <dl className="confirm-dialog-facts">
            {facts.map(({ label, value, strong }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={strong ? "confirm-dialog-fact-strong" : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
        {acknowledge && (
          <label className="checkbox">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            {acknowledge}
          </label>
        )}
      </div>
      <div className="confirm-dialog-actions">
        <button ref={cancel} type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className={danger ? "btn btn-destructive" : "btn btn-primary"}
          disabled={Boolean(acknowledge) && !acknowledged}
          onClick={(event) => {
            // Der zweite Klick eines Doppelklicks auf den Auslöser kann hier landen, wenn der Knopf über ihm liegt
            if (event.detail > 1) return;
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
