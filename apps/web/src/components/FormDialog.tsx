import { type FocusEvent, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Formular in einem modalen <dialog>, ohne das Formular zu verlassen, in dem die Eingabe gebraucht wird. Er hält den
 * Fokus und schließt mit Escape; er hängt am body, weil sein Formular sonst in einem anderen Formular stünde. Geschlossen
 * steht er gar nicht im Dokument, damit sein Name kein Feld der Seite überdeckt.
 */
export function FormDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <OpenFormDialog title={title} onClose={onClose}>
      {children}
    </OpenFormDialog>,
    document.body,
  );
}

function OpenFormDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="form-dialog" aria-labelledby="form-dialog-title" onClose={onClose} onFocus={fokusSichtbarHalten}>
      <h2 id="form-dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

/**
 * Hält das Element mit Fokus über der stehenden Knopfzeile (WCAG 2.4.11). Der Browser scrollt beim Fokus nur, wenn das
 * Element ganz außer Sicht liegt; halb hinter der Knopfzeile bliebe es verdeckt, scroll-padding greift dann nicht.
 */
function fokusSichtbarHalten(event: FocusEvent<HTMLDialogElement>) {
  const form = event.currentTarget.querySelector<HTMLElement>(":scope > form");
  const knopfzeile = form?.querySelector(":scope > .actions:last-child");
  const ziel = event.target;
  // Das Formular selbst bekommt den Fokus, wenn es scrollt (Chrome macht Scrollbereiche fokussierbar, showModal() nimmt
  // dann es statt des ersten Felds); dann nichts verschieben, sonst rutscht das erste Feld aus dem Bild
  if (!form || !knopfzeile || !(ziel instanceof Element) || ziel === form || !form.contains(ziel) || knopfzeile.contains(ziel)) return;
  // Der FilePicker versteckt sein <input type="file">; zu sehen ist der Knopf daneben
  const sichtbar = (ziel.closest(".file-picker") ?? ziel).getBoundingClientRect();
  const unten = knopfzeile.getBoundingClientRect().top - 16;
  const oben = form.getBoundingClientRect().top + 16;
  if (sichtbar.bottom > unten) form.scrollTop += sichtbar.bottom - unten;
  else if (sichtbar.top < oben) form.scrollTop -= oben - sichtbar.top;
}
