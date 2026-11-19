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
 * Felder der Suche (#1438): erst die Bezeichnung, damit ein genauer Name vor Treffern über die Gruppe steht („Bewirtung“
 * vor „Werbung“, deren Gruppe „Werbung und Bewirtung“ heißt), dann die Nummer des Kontos aus dem Label „6805 · Telefon“, dann
 * die Gruppe. Ein Label ohne Nummer („Erlöse“) bleibt, wie es ist.
 */
export function kategorieSuchfelder(label: string, gruppe: string): string[] {
  const i = label.indexOf(" · ");
  return i < 0 ? [label, gruppe] : [label.slice(i + 3), label.slice(0, i), gruppe];
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
  gruppe = gruppeVon,
  sortieren = true,
  ...control
}: FieldControlProps & {
  categories: CategoryChoice[];
  value: string;
  onChoose: (value: string) => void;
  required?: boolean;
  /** Gruppe einer Kategorie; Vorgabe sind die Gruppen der Ausgaben, „Direkt buchen“ führt zusätzlich die Einnahmen */
  gruppe?: (value: string) => string;
  /** Nach den Gruppen sortieren; false lässt die Reihenfolge der Liste, wo sie schon feststeht */
  sortieren?: boolean;
}) {
  /** Was gerade getippt ist; null = es steht die gewählte Kategorie im Feld */
  const [query, setQuery] = useState<string | null>(null);
  const chosen = categories.find((c) => c.value === value);
  // Reihenfolge wie im bisherigen Auswahlfeld mit Gruppen (#1253)
  const sorted = sortieren ? [...categories].sort((a, b) => kategorieRang(a.value) - kategorieRang(b.value)) : categories;

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
      search={() => searchOptions(sorted, query ?? "", (c) => kategorieSuchfelder(c.label, gruppe(c.value)))}
      describe={(c) => ({ key: c.value, label: c.label, meta: gruppe(c.value), selected: c.value === value })}
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
