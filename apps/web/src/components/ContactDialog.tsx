import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { ContactForm, type ExistingContact, type SavedContact } from "./ContactForm.tsx";

/**
 * Neuen Kontakt anlegen, ohne das Formular zu verlassen, in dem er gebraucht wird (Beleg, Rechnungs- und
 * Angebotsentwurf, #330). Ein modaler <dialog> hält den Fokus und schließt mit Escape; er hängt am body, weil
 * das Kontaktformular sonst in einem anderen Formular stünde. Abbrechen und Fehler lassen die Eingaben draußen stehen.
 */
export function ContactDialog({
  open,
  title,
  prefill,
  existing,
  onSaved,
  onPickExisting,
  onClose,
}: {
  open: boolean;
  title: string;
  prefill: Partial<ContactInput>;
  existing: ExistingContact[];
  onSaved: (saved: SavedContact) => void;
  onPickExisting: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={ref} className="contact-dialog" aria-labelledby="contact-dialog-title" onClose={onClose}>
      <h2 id="contact-dialog-title">{title}</h2>
      {open && (
        <ContactForm
          contact={null}
          prefill={prefill}
          existing={existing}
          onSaved={(saved) => {
            onSaved(saved);
            onClose();
          }}
          onPickExisting={(id) => {
            onPickExisting(id);
            onClose();
          }}
          onCancel={onClose}
        />
      )}
    </dialog>,
    document.body,
  );
}
