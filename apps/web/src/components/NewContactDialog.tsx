import { useRouter } from "@tanstack/react-router";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { ContactForm, type IbanSuggestion, type SavedContact } from "./ContactForm.tsx";
import { FormDialog } from "./FormDialog.tsx";

const TITLE = { kunde: "Neuen Kunden anlegen", lieferant: "Neuen Lieferanten anlegen" } as const;

/**
 * Neuen Kontakt anlegen, wo er gebraucht wird (Rechnungsentwurf, wiederkehrende Rechnung, Beleg, Dauerbeleg, #330): Kunde
 * oder Lieferant ist nur die Vorbelegung der Rolle, im Formular gehen beide. Abbrechen und Fehler lassen die Eingaben
 * draußen stehen. Gehört neben das Formular, nicht hinein: Das Formular im Dialog schickte sonst auch das äußere ab.
 * Gibt es die USt-IdNr. schon, weist das Formular darauf hin (UstIdHinweis).
 */
export function NewContactDialog({
  rolle,
  name,
  prefill = {},
  ibanSuggestion = null,
  onSaved,
  onPickExisting,
  onClose,
}: {
  rolle: "kunde" | "lieferant";
  /** Getippter Name; null = geschlossen */
  name: string | null;
  /** Was das Formular schon weiß (Name, USt-IdNr., bei einem Beleg auch Anschrift und E-Mail aus der E-Rechnung) */
  prefill?: Partial<ContactInput>;
  /** IBAN vom Beleg zum ausdrücklichen Übernehmen (#329) */
  ibanSuggestion?: IbanSuggestion | null;
  onSaved: (saved: SavedContact) => void;
  onPickExisting: (id: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <FormDialog open={name !== null} title={TITLE[rolle]} onClose={onClose}>
      <ContactForm
        contact={null}
        prefill={{ ...prefill, ...(name ? { name } : {}), isCustomer: rolle === "kunde", isSupplier: rolle === "lieferant" }}
        ibanSuggestion={ibanSuggestion}
        onSaved={(saved) => {
          onSaved(saved);
          // Die Kontaktliste neu laden; die übrigen Eingaben bleiben stehen, das Formular wird nicht neu aufgebaut
          void router.invalidate();
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
