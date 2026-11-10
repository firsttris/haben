import { formatEuro, kategorieAnteil, type DirektKategorie } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { Field } from "./Field.tsx";

/** Kategorie und Steuersatz eines direkt gebuchten Bankumsatzes (packages/core/src/direkt-kategorie.ts) */
export interface KategorieWahl {
  kategorie: DirektKategorie;
  steuersatz: number;
}

export interface KategorieOptionen {
  kategorien: { value: DirektKategorie; label: string; art: "einnahme" | "ausgabe" }[];
  /** Stand heute; ob am Tag der Zahlung, prüft der Server */
  kleinunternehmer: boolean;
}

const steuersatzFuer = (options: KategorieOptionen, kategorie: DirektKategorie) =>
  options.kategorien.find((k) => k.value === kategorie)?.art === "einnahme" && !options.kleinunternehmer ? 1900 : 0;

/** Vorbelegung nach Richtung: ein Eingang ist meist eine Einnahme, ein Ausgang eine Ausgabe */
export function kategorieWahlFuer(options: KategorieOptionen, amount: number): KategorieWahl {
  const kategorie = amount > 0 ? "erloese" : "sonstiges";
  return { kategorie, steuersatz: steuersatzFuer(options, kategorie) };
}

export function KategorieFelder({
  options,
  value,
  amount,
  onChange,
}: {
  options: KategorieOptionen;
  value: KategorieWahl;
  /** Betrag mit Vorzeichen wie auf dem Konto, für die Aufteilung in Netto und Steuer; null ohne gültigen Betrag */
  amount: number | null;
  onChange: (wahl: KategorieWahl) => void;
}) {
  const einnahme = options.kategorien.find((k) => k.value === value.kategorie)?.art === "einnahme";
  const anteil = amount !== null && einnahme && value.steuersatz !== 0 ? kategorieAnteil(value, amount) : null;
  // Auswahl und Hinweis nach dem gewählten Satz, nicht nach dem Stand von heute: Ein gelernter Vorschlag (#295) kann aus
  // einem Monat mit anderem Kleinunternehmer-Stand stammen; gebucht wird, was hier steht (Stand am Tag der Zahlung prüft der Server)
  const ohneSteuer = einnahme && value.steuersatz === 0;
  const mitAuswahl = einnahme && !(options.kleinunternehmer && ohneSteuer);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="form-row cols-2">
        <Field label="Kategorie">
          {(control) => (
            <select
              {...control}
              value={value.kategorie}
              onChange={(e) => {
                const kategorie = e.target.value as DirektKategorie;
                onChange({ kategorie, steuersatz: steuersatzFuer(options, kategorie) });
              }}
            >
              {(["einnahme", "ausgabe"] as const).map((art) => (
                <optgroup key={art} label={art === "einnahme" ? "Einnahmen" : "Ausgaben"}>
                  {options.kategorien
                    .filter((k) => k.art === art)
                    .map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        {mitAuswahl && (
          <Field label="Steuersatz">
            {(control) => (
              <select {...control} value={value.steuersatz} onChange={(e) => onChange({ ...value, steuersatz: Number(e.target.value) })}>
                <option value={1900}>19 %</option>
                <option value={700}>7 %</option>
                {(options.kleinunternehmer || ohneSteuer) && <option value={0}>ohne (Kleinunternehmer)</option>}
              </select>
            )}
          </Field>
        )}
      </div>
      <span className="small muted">
        {!einnahme ? (
          <>
            Gebucht brutto als Ausgabe, ohne Vorsteuer: Die gibt es nur mit Rechnung. Mit Rechnung den Beleg unter <Link to="/belege">Belege</Link> buchen.
          </>
        ) : ohneSteuer ? (
          "Als Kleinunternehmer ohne Umsatzsteuer (§ 19 UStG)."
        ) : (
          `Bank an Erlöse und Umsatzsteuer, fällig mit der Zahlung, bei Ist- wie bei Soll-Versteuerung${
            anteil ? `: ${formatEuro(Math.abs(anteil.base))} netto, ${formatEuro(Math.abs(anteil.tax))} Umsatzsteuer` : ""
          }.`
        )}
      </span>
    </div>
  );
}
