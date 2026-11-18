import { useState } from "react";
import { searchOptions } from "../lib/combobox.ts";
import { Combobox } from "./Combobox.tsx";
import type { FieldControlProps } from "./Field.tsx";
import { gruppeVon, kategorieRang } from "./KategorieGruppen.ts";

export interface CategoryChoice {
  value: string;
  label: string;
}

/**
 * Kategorie suchen und wählen, statt in einer langen Liste zu blättern. Wer die Eingabe stehen lässt, ohne zu wählen,
 * behält die bisherige Kategorie; ein geleertes Feld nimmt sie beim Verlassen oder bei Enter weg (onChoose mit leerem
 * Wert). Bei Enter, weil das Formular sonst die alte Kategorie speicherte, die nicht mehr im Feld steht; nicht schon beim
 * Leeren, denn wer danach dieselbe wieder wählt, behielte sonst Konto und Privatanteil nicht.
 */
export function CategoryCombobox({
  categories,
  value,
  onChoose,
  required = false,
  ...control
}: FieldControlProps & {
  categories: CategoryChoice[];
  value: string;
  onChoose: (value: string) => void;
  required?: boolean;
}) {
  /** Was gerade getippt ist; null = es steht die gewählte Kategorie im Feld */
  const [query, setQuery] = useState<string | null>(null);
  const chosen = categories.find((c) => c.value === value);
  // Reihenfolge wie im bisherigen Auswahlfeld mit Gruppen (#1253)
  const sorted = [...categories].sort((a, b) => kategorieRang(a.value) - kategorieRang(b.value));

  function leerUebernehmen() {
    // Ein Feld, das schon leer war, bleibt unberührt, sonst gälte der Beleg als geändert und der Privatanteil ginge verloren
    if (query !== null && query.trim() === "" && value !== "") onChoose("");
  }

  return (
    <Combobox
      {...control}
      commitOnTab
      value={query ?? chosen?.label ?? ""}
      onInput={setQuery}
      search={() => searchOptions(sorted, query ?? "", (c) => [c.label, gruppeVon(c.value)])}
      describe={(c) => ({ key: c.value, label: c.label, meta: gruppeVon(c.value), selected: c.value === value })}
      onPick={(c) => {
        setQuery(null);
        // Dieselbe Kategorie noch einmal: nichts ändern, sonst setzte der Beleg Konto und Privatanteil zurück
        if (c.value !== value) onChoose(c.value);
      }}
      placeholder="Bitte wählen oder suchen"
      required={required}
      onKeyDown={(event) => {
        if (event.key === "Enter") leerUebernehmen();
      }}
      onBlur={() => {
        leerUebernehmen();
        setQuery(null);
      }}
    />
  );
}
