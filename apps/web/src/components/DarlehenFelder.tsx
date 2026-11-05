import type { DarlehenTeil } from "@haben/core";
import { Link } from "@tanstack/react-router";

/** Darlehen und Teil (Auszahlung, Tilgung, Zinsen, Gebühren) eines Bankumsatzes (packages/core/src/darlehen.ts) */
export interface DarlehenWahl {
  loanId: string;
  part: DarlehenTeil;
}

export interface DarlehenOptionen {
  loans: { value: string; label: string }[];
  loanParts: { value: DarlehenTeil; label: string }[];
}

/** Vorbelegung nach Richtung: ein Eingang ist meist die Auszahlung, ein Ausgang die Tilgung */
export function darlehenWahlFuer(options: DarlehenOptionen, amount: number): DarlehenWahl {
  return { loanId: options.loans[0]?.value ?? "", part: amount > 0 ? "auszahlung" : "tilgung" };
}

const WIRKUNG: Record<DarlehenTeil, string> = {
  auszahlung: "Erfolgsneutral: Bank an Darlehen, der Bestand steigt.",
  tilgung: "Erfolgsneutral: Darlehen an Bank, der Bestand sinkt; höchstens bis zum Bestand.",
  zins: "Aufwand und in der EÜR Schuldzinsen; das Konto richtet sich nach der Verwendung des Darlehens.",
  gebuehr: "Kreditprovisionen und Verwaltungskostenbeiträge; in der EÜR bei den Schuldzinsen.",
};

export function DarlehenFelder({ options, value, onChange }: { options: DarlehenOptionen; value: DarlehenWahl; onChange: (wahl: DarlehenWahl) => void }) {
  if (options.loans.length === 0) {
    return (
      <span className="small">
        Noch kein Darlehen angelegt: <Link to="/darlehen">Darlehen anlegen</Link>.
      </span>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="form-row cols-2">
        <label className="field">
          Darlehen
          <select value={value.loanId} onChange={(e) => onChange({ ...value, loanId: e.target.value })}>
            {options.loans.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Teil der Rate
          <select value={value.part} onChange={(e) => onChange({ ...value, part: e.target.value as DarlehenTeil })}>
            {options.loanParts.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="small muted">{WIRKUNG[value.part]}</span>
    </div>
  );
}
