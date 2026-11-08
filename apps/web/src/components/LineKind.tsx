import type { QuoteLineKind } from "@haben/core";

/**
 * Art einer Angebotsposition: normal, optional oder Alternative zur Position davor (help.lexware.de, Artikel 547984
 * und 547989). Steht hinter der Bezeichnung in derselben Zeile; die Optionen sagen selbst, was sie bedeuten.
 */
export function LineKind({ index, kind, onKind }: { index: number; kind: QuoteLineKind | null; onKind: (value: QuoteLineKind | null) => void }) {
  return (
    <select
      className="line-kind"
      aria-label={`Art der Position ${index + 1}`}
      value={kind ?? ""}
      onChange={(e) => onKind((e.target.value || null) as QuoteLineKind | null)}
    >
      <option value="">Zählt zur Summe</option>
      <option value="optional">Optional</option>
      <option value="alternative" disabled={index === 0}>
        Alternative zur Position davor
      </option>
    </select>
  );
}
