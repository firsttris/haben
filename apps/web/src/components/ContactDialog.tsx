import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { ContactForm, type ExistingContact, type IbanSuggestion, type SavedContact } from "./ContactForm.tsx";

/**
 * Neuen Kontakt anlegen, ohne das Formular zu verlassen, in dem er gebraucht wird (Beleg, Rechnungs- und
 * Angebotsentwurf, #330). Ein modaler <dialog> hält den Fokus und schließt mit Escape; er hängt am body, weil
 * das Kontaktformular sonst in einem anderen Formular stünde. Abbrechen und Fehler lassen die Eingaben draußen stehen.
 * Geschlossen steht er gar nicht im Dokument, damit sein Name („Neuen Kunden anlegen“) kein Feld der Seite überdeckt.
 */
export function ContactDialog(props: Parameters<typeof OpenContactDialog>[0] & { open: boolean }) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<OpenContactDialog {...props} />, document.body);
}

function OpenContactDialog({
  title,
  prefill,
  existing,
  onSaved,
  onPickExisting,
  onClose,
  ibanSuggestion = null,
}: {
  title: string;
  prefill: Partial<ContactInput>;
  existing: ExistingContact[];
  onSaved: (saved: SavedContact) => void;
  onPickExisting: (id: string) => void;
  onClose: () => void;
  /** IBAN vom Beleg zum ausdrücklichen Übernehmen (#329) */
  ibanSuggestion?: IbanSuggestion | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="contact-dialog" aria-labelledby="contact-dialog-title" onClose={onClose}>
      <h2 id="contact-dialog-title">{title}</h2>
      <ContactForm
        contact={null}
        prefill={prefill}
        existing={existing}
        ibanSuggestion={ibanSuggestion}
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
    </dialog>
  );
}
