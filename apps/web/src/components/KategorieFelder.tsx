import { AUFLADUNG, formatEuro, kategorieAnteil, kategorieArt, type DirektKategorie } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { Field } from "./Field.tsx";
import { CategoryCombobox } from "./CategoryCombobox.tsx";
import { gruppeVon, kategorieRang } from "./KategorieGruppen.ts";

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

// Erlöse mit 19 % vorbelegt, als Kleinunternehmer ohne; nicht steuerbare Einnahme und Ausgaben immer ohne (#1131)
const steuersatzFuer = (options: KategorieOptionen, kategorie: DirektKategorie) => (kategorie === "erloese" && !options.kleinunternehmer ? 1900 : 0);

/** Vorbelegung nach Richtung: ein Eingang ist meist eine Einnahme, ein Ausgang eine Ausgabe */
export function kategorieWahlFuer(options: KategorieOptionen, amount: number): KategorieWahl {
  const kategorie = amount > 0 ? "erloese" : "sonstiges";
  return { kategorie, steuersatz: steuersatzFuer(options, kategorie) };
}

/**
 * Die Kategorien zur Auswahl: erst die Einnahmen, dann die Ausgaben in ihren Gruppen. Kleinunternehmer bekommen die nicht
 * steuerbare Einnahme nicht angeboten; eine schon gewählte (gelernter Vorschlag) bleibt sichtbar, sonst zeigte das Feld
 * „Erlöse“ (#1131). Den Stand am Tag der Zahlung prüft der Server.
 */
export function kategorieAngebot(options: KategorieOptionen, gewaehlt: DirektKategorie): { value: string; label: string }[] {
  const angeboten = options.kategorien.filter((k) => !(options.kleinunternehmer && k.value === "nichtSteuerbar" && gewaehlt !== "nichtSteuerbar"));
  const ausgaben = angeboten.filter((k) => k.art === "ausgabe").sort((a, b) => kategorieRang(a.value) - kategorieRang(b.value));
  return [...angeboten.filter((k) => k.art === "einnahme"), ...ausgaben];
}

/** Gruppe in der Auswahl: die Einnahmen für sich, die Ausgaben in ihren Gruppen */
const gruppeDirekt = (kategorie: string) => (kategorieArt(kategorie) === "einnahme" ? "Einnahmen" : gruppeVon(kategorie));

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
  const nichtSteuerbar = value.kategorie === "nichtSteuerbar";
  const anteil = amount !== null && einnahme && value.steuersatz !== 0 ? kategorieAnteil(value, amount) : null;
  // Auswahl und Hinweis nach dem gewählten Satz, nicht nach dem Stand von heute: Ein gelernter Vorschlag (#295) kann aus
  // einem Monat mit anderem Kleinunternehmer-Stand stammen; gebucht wird, was hier steht (Stand am Tag der Zahlung prüft der Server)
  const ohneSteuer = einnahme && !nichtSteuerbar && value.steuersatz === 0;
  const mitAuswahl = einnahme && !nichtSteuerbar && !(options.kleinunternehmer && ohneSteuer);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="form-row cols-2">
        <Field label="Kategorie">
          {(control) => (
            <CategoryCombobox
              {...control}
              categories={kategorieAngebot(options, value.kategorie)}
              gruppe={gruppeDirekt}
              sortieren={false}
              value={value.kategorie}
              onChoose={(wert) => {
                // Ein geleertes Feld lässt die bisherige Kategorie stehen: gebucht wird immer auf eine
                if (wert === "") return;
                const kategorie = wert as DirektKategorie;
                onChange({ kategorie, steuersatz: steuersatzFuer(options, kategorie) });
              }}
              required
            />
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
        ) : nichtSteuerbar ? (
          "Gebucht als Einnahme ohne Umsatzsteuer, nicht in der Voranmeldung. Ob echter Schadenersatz vorliegt, entscheidest du bzw. deine Steuerberatung."
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

/**
 * Wahl einer Aufladung (#1356): Eine Aufladung ist eine Ausgabe ohne Steuersatz. Steht aus einem gelernten Vorschlag
 * (#295) noch eine Einnahme oder ein Steuersatz in der Wahl, gilt „Sonstiger Aufwand“ ohne Satz — Anzeige und Buchung
 * lesen beide hier.
 */
export function aufladungWahl(wahl: KategorieWahl): KategorieWahl {
  return { kategorie: kategorieArt(wahl.kategorie) === "ausgabe" ? wahl.kategorie : "sonstiges", steuersatz: 0 };
}

/** Eintrag im Zuordnungsdialog, direkt neben „Kategorie“ (#1356) */
export const AUFLADUNG_OPTION = { value: "aufladung", label: AUFLADUNG.text } as const;

/** Hinweis unter den Feldern einer Aufladung: warum kein Steuersatz und wann die Vorsteuer entsteht (#1356) */
const AUFLADUNG_HINWEIS =
  "Gebucht als Aufwand im Monat der Zahlung (§ 11 Abs. 2 EStG). Die Aufladung selbst trägt keine Umsatzsteuer (§ 3 Abs. 15 UStG, Mehrzweck-Gutschein); die Vorsteuer entsteht erst mit der Rechnung über die Leistung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG).";

/**
 * Felder einer Aufladung eines Guthabens (#1356): dieselbe Kategorie wie bei „Direkt buchen“, aber nur Ausgaben. Einen
 * Steuersatz gibt es hier nicht: Die Aufladung selbst unterliegt nicht der Umsatzsteuer (§ 3 Abs. 15 UStG), die Vorsteuer
 * entsteht erst mit der Rechnung über die Leistung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG).
 */
export function AufladungFelder({
  options,
  value,
  amount,
  onChange,
}: {
  options: KategorieOptionen;
  value: KategorieWahl;
  amount: number | null;
  onChange: (wahl: KategorieWahl) => void;
}) {
  const ausgaben = { ...options, kategorien: options.kategorien.filter((k) => k.art === "ausgabe") };
  return (
    <>
      <KategorieFelder options={ausgaben} value={aufladungWahl(value)} amount={amount} onChange={onChange} />
      <span className="small muted">{AUFLADUNG_HINWEIS}</span>
    </>
  );
}

/**
 * Felder einer Direktbuchung auf eine Kategorie (#1356): dieselben Felder für „Kategorie“ und „Aufladung“, nur die
 * Aufladung ohne Steuersatz. Eine Stelle, damit Dialog und Buchung dieselbe Wahl lesen.
 */
export function DirektKategorieFelder({
  kind,
  ...felder
}: {
  kind: "kategorie" | "aufladung";
  options: KategorieOptionen;
  value: KategorieWahl;
  amount: number | null;
  onChange: (wahl: KategorieWahl) => void;
}) {
  return kind === "aufladung" ? <AufladungFelder {...felder} /> : <KategorieFelder {...felder} />;
}
