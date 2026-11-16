import { parseWholePercent } from "@haben/core";
import { Field } from "./Field.tsx";

/*
 * Vorgaben für den Privatanteil je Belegkategorie in den Firmendaten, nur im Einzelunternehmen (#1221). Ganze Prozent
 * von 0 bis 100 wie der Privatanteil am Beleg; was das Feld nicht lesen kann, steht als Fehler am Feld, statt still zu
 * verschwinden.
 */

const KATEGORIEN = { telefon: "Telefon", internet: "Internet" } as const;
type Kategorie = keyof typeof KATEGORIEN;
export type PrivatanteilTexte = Record<Kategorie, string>;
type Feld = `privateShare-${Kategorie}`;

const KEYS = Object.keys(KATEGORIEN) as Kategorie[];
const FEHLER = "Trag eine ganze Zahl von 0 bis 100 ein.";

/** Gespeicherte Vorgaben als Text für die Felder; ohne Vorgabe leer */
export function privatanteilTexte(shares: Partial<Record<string, number>>): PrivatanteilTexte {
  return { telefon: shares.telefon ? String(shares.telefon) : "", internet: shares.internet ? String(shares.internet) : "" };
}

/** Anteil aus dem Text: leer ist 0, sonst ganze Prozent über parseWholePercent; null, wenn ungültig oder über 100 */
const anteil = (text: string) => {
  if (text.trim() === "") return 0;
  const value = parseWholePercent(text);
  return value !== null && value <= 100 ? value : null;
};

/** Fehler je Feld für useSubmitCheck; in einer Kapitalgesellschaft fehlt der Abschnitt und damit jeder Fehler */
export function privatanteilFehler(texte: PrivatanteilTexte, gesellschaft: boolean): Record<Feld, string | null> {
  const fehler = (key: Kategorie) => (!gesellschaft && anteil(texte[key]) === null ? FEHLER : null);
  return { "privateShare-telefon": fehler("telefon"), "privateShare-internet": fehler("internet") };
}

/** Vorgaben zum Speichern: nur Kategorien mit einem Anteil über 0; in einer Kapitalgesellschaft keine */
export function privatanteilWerte(texte: PrivatanteilTexte, gesellschaft: boolean): Partial<Record<Kategorie, number>> {
  if (gesellschaft) return {};
  return Object.fromEntries(KEYS.map((key) => [key, anteil(texte[key]) ?? 0] as const).filter(([, value]) => value > 0));
}

export function PrivatanteilVorgaben({
  texte,
  onChange,
  error,
}: {
  texte: PrivatanteilTexte;
  onChange: (texte: PrivatanteilTexte) => void;
  error: (name: Feld) => string | undefined;
}) {
  return (
    <section className="form-section" aria-labelledby="company-private">
      <h3 id="company-private">Privatanteile</h3>
      <div className="form-row cols-2">
        {KEYS.map((key) => (
          <Field key={key} label={`Privatanteil ${KATEGORIEN[key]} in %`} describedBy="private-share-hint" error={error(`privateShare-${key}`)}>
            {(control) => (
              <input
                {...control}
                name={`privateShare-${key}`}
                inputMode="numeric"
                value={texte[key]}
                onChange={(event) => onChange({ ...texte, [key]: event.target.value })}
                placeholder="0"
              />
            )}
          </Field>
        ))}
      </div>
      <p id="private-share-hint" className="field-hint">
        Vorgabe für neue Belege dieser Kategorien: Nur der betriebliche Teil wird Ausgabe und Vorsteuer, der private Teil ist eine Entnahme. Am einzelnen Beleg
        lässt sich der Anteil ändern.
      </p>
    </section>
  );
}
