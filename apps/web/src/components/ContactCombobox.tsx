import { useState } from "react";
import { searchOptions } from "../lib/combobox.ts";
import { Combobox } from "./Combobox.tsx";
import type { FieldControlProps } from "./Field.tsx";

export interface ContactChoice {
  id: string;
  name: string;
  ort: string;
  /** Kundennummer, bei Lieferanten die Lieferantennummer */
  nummer: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  ustId: string;
}

export type ContactRole = "kunde" | "lieferant" | "alle";

/** Was sich je Rolle unterscheidet: Platzhalter und Beschriftung der Zeile zum Anlegen */
const ROLE_TEXT: Record<ContactRole, { placeholder: string; createNamed: (name: string) => string; createEmpty: string }> = {
  kunde: {
    placeholder: "Name, Kundennummer oder Ort",
    createNamed: (name) => `„${name}“ als neuen Kunden anlegen`,
    createEmpty: "Neuen Kontakt anlegen",
  },
  lieferant: {
    placeholder: "Name, Lieferantennummer oder Ort",
    createNamed: (name) => `„${name}“ als neuen Lieferanten anlegen`,
    createEmpty: "Neuen Lieferanten anlegen",
  },
  alle: {
    placeholder: "Name oder Ort",
    createNamed: (name) => `„${name}“ als neuen Kontakt anlegen`,
    createEmpty: "Neuen Kontakt anlegen",
  },
};

const inRole = (c: ContactChoice, rolle: ContactRole) => rolle === "alle" || (rolle === "kunde" ? c.isCustomer : c.isSupplier);

const contactText = (c: ContactChoice) => `${c.name}${c.ort ? ` · ${c.ort}` : ""}`;

/**
 * Kontakt suchen und wählen: der Kunde im Rechnungs- und Angebotsentwurf, der Lieferant am Beleg und im Dauerbeleg,
 * suchbar nach Name, Nummer und Ort. Zur Auswahl stehen die Kontakte der Rolle (Kunde, Lieferant oder alle); ein
 * schon gewählter Kontakt bleibt sichtbar. Wer die Eingabe stehen lässt, ohne zu wählen, behält den bisherigen
 * Kontakt; ein geleertes Feld nimmt ihn weg (onChoose mit leerer id). Ohne onCreate fehlt die Zeile zum Anlegen.
 */
export function ContactCombobox({
  contacts,
  contactId,
  rolle,
  disabled = false,
  required = false,
  placeholder,
  onChoose,
  onCreate,
  ...control
}: FieldControlProps & {
  contacts: ContactChoice[];
  contactId: string;
  rolle: ContactRole;
  disabled?: boolean;
  required?: boolean;
  /** Statt des Platzhalters der Rolle, etwa „Für alle Kunden“ bei einer Auswahl, die leer bleiben darf */
  placeholder?: string;
  onChoose: (contactId: string) => void;
  /** Dialog für den neuen Kontakt, mit dem getippten Namen */
  onCreate?: (name: string) => void;
}) {
  const text = ROLE_TEXT[rolle];
  /** Was gerade getippt ist; null = es steht der gewählte Kontakt im Feld */
  const [query, setQuery] = useState<string | null>(null);
  const choosable = contacts.filter((c) => inRole(c, rolle) || c.id === contactId);
  const chosen = contacts.find((c) => c.id === contactId);
  const typed = query?.trim() ?? "";
  /** Bei Lieferanten hilft die USt-IdNr. bei der Wahl: Sie steht in der zweiten Zeile und ist durchsuchbar */
  const ustIdOf = (c: ContactChoice) => (rolle === "lieferant" ? c.ustId : "");

  function choose(next: string) {
    setQuery(null);
    // Derselbe Kontakt noch einmal: nichts ändern, sonst setzte das Format, Sprache und Skonto zurück
    if (next !== contactId) onChoose(next);
  }

  return (
    <Combobox
      {...control}
      commitOnTab
      value={query ?? (chosen ? contactText(chosen) : "")}
      onInput={setQuery}
      search={() => searchOptions(choosable, query ?? "", (c) => [c.name, c.nummer, c.ort, ustIdOf(c)])}
      describe={(c) => ({
        key: c.id,
        label: c.name,
        meta: [c.nummer, c.ort, ustIdOf(c)].filter(Boolean).join(" · "),
        selected: c.id === contactId,
      })}
      onPick={(c) => choose(c.id)}
      create={
        onCreate
          ? {
              label: typed ? text.createNamed(typed) : text.createEmpty,
              run: () => {
                setQuery(null);
                onCreate(typed);
              },
            }
          : null
      }
      placeholder={placeholder ?? text.placeholder}
      disabled={disabled}
      required={required}
      onBlur={() => {
        if (query === null) return;
        if (typed === "") choose("");
        else setQuery(null);
      }}
    />
  );
}
