/** Lieferant aus den Kontakten wählen; Name und USt-IdNr. übernimmt der Beleg, der Rest bleibt zu prüfen */

export interface SupplierOption {
  id: string;
  name: string;
  ustId: string;
}

export function SupplierPicker({
  suppliers,
  value,
  onPick,
}: {
  suppliers: SupplierOption[];
  /** Gewählter Kontakt; null = frei eingetragen */
  value: string | null;
  onPick: (supplier: SupplierOption | null) => void;
}) {
  if (suppliers.length === 0) {
    return <span className="small muted">Lieferanten aus den Kontakten stehen hier zur Auswahl, sobald ein Kontakt die Rolle „Lieferant“ hat.</span>;
  }
  return (
    <label className="field">
      Aus den Kontakten
      <select value={value ?? ""} onChange={(e) => onPick(suppliers.find((s) => s.id === e.target.value) ?? null)}>
        <option value="">frei eingetragen</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.ustId ? ` · ${s.ustId}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
