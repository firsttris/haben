import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

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

/**
 * Rückfrage vor einer folgenreichen Aktion (#404). Ein modaler <dialog> am body wie ContactDialog: Er sperrt die
 * Seite, sodass ein Doppelklick auf den Auslöser nichts ausführen kann. Geschlossen steht er nicht im Dokument.
 */
export function ConfirmDialog({ open, ...props }: ConfirmDialogProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<OpenConfirmDialog {...props} />, document.body);
}

function OpenConfirmDialog({ title, confirmLabel, danger = false, onConfirm, onClose, children }: Omit<ConfirmDialogProps, "open">) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

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
      <h2 id={titleId}>{title}</h2>
      <div id={bodyId} className="confirm-dialog-body">
        {children}
      </div>
      <div className="confirm-dialog-actions">
        <button ref={cancel} type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className={danger ? "btn btn-destructive" : "btn btn-primary"}
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
