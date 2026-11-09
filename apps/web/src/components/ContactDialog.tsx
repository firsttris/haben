import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { ContactForm, type ExistingContact, type IbanSuggestion, type SavedContact } from "./ContactForm.tsx";
import { FormDialog } from "./FormDialog.tsx";

/** Neuen Kontakt anlegen, wo er gebraucht wird (Beleg, Rechnungs- und Angebotsentwurf, #330). Abbrechen und Fehler lassen die Eingaben draußen stehen. */
export function ContactDialog({
  open,
  title,
  prefill,
  existing,
  onSaved,
  onPickExisting,
  onClose,
  ibanSuggestion = null,
}: {
  open: boolean;
  title: string;
  prefill: Partial<ContactInput>;
  existing: ExistingContact[];
  onSaved: (saved: SavedContact) => void;
  onPickExisting: (id: string) => void;
  onClose: () => void;
  /** IBAN vom Beleg zum ausdrücklichen Übernehmen (#329) */
  ibanSuggestion?: IbanSuggestion | null;
}) {
  return (
    <FormDialog open={open} title={title} onClose={onClose}>
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
    </FormDialog>
  );
}
