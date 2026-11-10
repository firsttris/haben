import { useRouter } from "@tanstack/react-router";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import type { ContactChoice } from "./ContactCombobox.tsx";
import { ContactDialog } from "./ContactDialog.tsx";
import type { IbanSuggestion } from "./ContactForm.tsx";

/**
 * Neuen Lieferanten anlegen, wo er gebraucht wird (Beleg, Dauerbeleg): Name und USt-IdNr. wie im Formular, danach ist er
 * dort gewählt. Gehört neben das Formular, nicht hinein: Das Formular im Dialog schickte sonst auch das äußere ab.
 */
export function NewSupplierDialog({
  name,
  prefill,
  suppliers,
  ibanSuggestion = null,
  onPick,
  onClose,
}: {
  /** Getippter Name; null = geschlossen */
  name: string | null;
  /** Was das Formular schon weiß (Name, USt-IdNr., bei einem Beleg auch Anschrift und E-Mail aus der E-Rechnung) */
  prefill: Partial<ContactInput>;
  suppliers: ContactChoice[];
  /** IBAN vom Beleg zum ausdrücklichen Übernehmen (#329) */
  ibanSuggestion?: IbanSuggestion | null;
  onPick: (supplier: ContactChoice) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <ContactDialog
      open={name !== null}
      title="Neuen Lieferanten anlegen"
      prefill={{ ...prefill, ...(name ? { name } : {}), isCustomer: false, isSupplier: true }}
      ibanSuggestion={ibanSuggestion}
      existing={suppliers}
      onSaved={(saved) => {
        onPick({ id: saved.id, name: saved.name, ort: saved.ort ?? "", nummer: null, ustId: saved.ustId ?? "", isCustomer: false, isSupplier: true });
        // Die Lieferantenliste neu laden; die übrigen Eingaben bleiben stehen
        void router.invalidate();
      }}
      onPickExisting={(id) => {
        const supplier = suppliers.find((s) => s.id === id);
        if (supplier) onPick(supplier);
      }}
      onClose={onClose}
    />
  );
}
