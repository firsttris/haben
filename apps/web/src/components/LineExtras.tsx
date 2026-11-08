import type { QuoteLineKind } from "@haben/core";

/**
 * Zusatzangaben unter einer Position: Positionsrabatt („10 %“ oder „50,00“) und im Angebot die Art – normal, optional
 * oder Alternative zur Position davor (help.lexware.de, Artikel 547984 und 547989).
 */
export function LineExtras({
  index,
  discount,
  discountError,
  onDiscount,
  onBlur,
  kind,
  onKind,
}: {
  index: number;
  discount: string;
  discountError: boolean;
  onDiscount: (value: string) => void;
  onBlur: () => void;
  /** undefined = keine Auswahl der Art (Rechnung) */
  kind?: QuoteLineKind | null;
  onKind: (value: QuoteLineKind | null) => void;
}) {
  const n = index + 1;
  return (
    <div className="line-extra">
      <label>
        Rabatt
        <input
          className="mono"
          value={discount}
          placeholder="z. B. 10 % oder 50,00"
          aria-label={`Rabatt Position ${n}, Prozent oder Betrag`}
          aria-invalid={discountError}
          onChange={(e) => onDiscount(e.target.value)}
          onBlur={onBlur}
        />
      </label>
      {kind !== undefined && (
        <label>
          Art
          <select aria-label={`Art der Position ${n}`} value={kind ?? ""} onChange={(e) => onKind((e.target.value || null) as QuoteLineKind | null)}>
            <option value="">Zählt zur Summe</option>
            <option value="optional">Optional</option>
            <option value="alternative" disabled={index === 0}>
              Alternative zur Position davor
            </option>
          </select>
        </label>
      )}
    </div>
  );
}
