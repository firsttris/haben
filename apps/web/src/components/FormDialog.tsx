import { useEffect, useRef, type ReactNode } from "react";
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
    <dialog ref={ref} className="form-dialog" aria-labelledby="form-dialog-title" onClose={onClose}>
      <h2 id="form-dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
