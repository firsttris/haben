import { useState } from "react";
import { searchOptions } from "../lib/combobox.ts";
import { Combobox } from "./Combobox.tsx";

export interface CustomerOption {
  id: string;
  name: string;
  ort: string;
  kundennummer: string | null;
  isCustomer: boolean;
}

const customerText = (c: CustomerOption) => `${c.name}${c.ort ? ` · ${c.ort}` : ""}`;

/**
 * Kunde im Rechnungs- und Angebotsentwurf, suchbar nach Name, Kundennummer und Ort. Zur Auswahl stehen nur Kunden; ein
 * schon gewählter Kontakt bleibt sichtbar. Wer die Eingabe stehen lässt, ohne zu wählen, behält den bisherigen Kunden;
 * ein geleertes Feld nimmt ihn weg.
 */
export function CustomerCombobox({
  id,
  contacts,
  contactId,
  disabled,
  onChoose,
  onCreate,
}: {
  id: string;
  contacts: CustomerOption[];
  contactId: string;
  disabled: boolean;
  onChoose: (contactId: string) => void;
  /** Dialog für den neuen Kontakt, mit dem getippten Namen */
  onCreate: (name: string) => void;
}) {
  /** Was gerade getippt ist; null = es steht der gewählte Kunde im Feld */
  const [query, setQuery] = useState<string | null>(null);
  const customers = contacts.filter((c) => c.isCustomer || c.id === contactId);
  const chosen = contacts.find((c) => c.id === contactId);
  const typed = query?.trim() ?? "";

  function choose(next: string) {
    setQuery(null);
    // Derselbe Kunde noch einmal: nichts ändern, sonst setzte das Format, Sprache und Skonto zurück
    if (next !== contactId) onChoose(next);
  }

  return (
    <Combobox
      commitOnTab
      id={id}
      value={query ?? (chosen ? customerText(chosen) : "")}
      onInput={setQuery}
      search={() => searchOptions(customers, query ?? "", (c) => [c.name, c.kundennummer, c.ort])}
      describe={(c) => ({
        key: c.id,
        label: c.name,
        meta: [c.kundennummer, c.ort].filter(Boolean).join(" · "),
        selected: c.id === contactId,
      })}
      onPick={(c) => choose(c.id)}
      create={{
        label: typed ? `„${typed}“ als neuen Kunden anlegen` : "Neuen Kontakt anlegen",
        run: () => {
          setQuery(null);
          onCreate(typed);
        },
      }}
      placeholder="Name, Kundennummer oder Ort"
      disabled={disabled}
      onBlur={() => {
        if (query === null) return;
        if (typed === "") choose("");
        else setQuery(null);
      }}
    />
  );
}
