import { BESCHAEFTIGUNGSARTEN, formatDecimal, KONFESSIONEN, parseEuro, type Beschaeftigungsart, type Konfession } from "@haben/core";
import { useState, type FormEvent, type ReactNode } from "react";

/*
 * Stammdaten eines Mitarbeiters für die Lohnabrechnung. Beträge in Euro, Sätze in Prozent, Faktor und Kinderfreibeträge
 * mit Komma; gespeichert wird in Cent, Basispunkten und Tausendsteln. Felder, die zur Beschäftigungsart nicht gehören,
 * bleiben ausgeblendet und behalten ihren Wert.
 */

export interface MitarbeiterWerte {
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
  geburtsdatum: string;
  steuerId: string;
  steuerklasse: number;
  faktor: number;
  kinderfreibetraege: number;
  konfession: Konfession | null;
  art: Beschaeftigungsart;
  monatsgehalt: number;
  krankenversicherung: "gesetzlich" | "privat";
  krankenkasse: string;
  krankenkasseBetriebsnummer: string;
  zusatzbeitrag: number;
  pkvBasisbeitrag: number;
  pkvZuschuss: number;
  kinderlosenzuschlag: boolean;
  kinderUnter25: number;
  u1Satz: number | null;
  u2Satz: number;
  rvBefreit: boolean;
  pauschsteuer: boolean;
  personengruppe: string;
  beitragsgruppen: string;
  taetigkeitsschluessel: string;
  svNummer: string;
  statusfeststellung: "" | "beantragt" | "versicherungsfrei" | "versicherungspflichtig";
  eintritt: string;
  austritt: string | null;
  iban: string;
}

export const NEUER_MITARBEITER: MitarbeiterWerte = {
  vorname: "",
  nachname: "",
  strasse: "",
  plz: "",
  ort: "",
  geburtsdatum: "",
  steuerId: "",
  steuerklasse: 1,
  faktor: 1000,
  kinderfreibetraege: 0,
  konfession: null,
  art: "ggf",
  monatsgehalt: 0,
  krankenversicherung: "gesetzlich",
  krankenkasse: "",
  krankenkasseBetriebsnummer: "",
  zusatzbeitrag: 290,
  pkvBasisbeitrag: 0,
  pkvZuschuss: 0,
  kinderlosenzuschlag: false,
  kinderUnter25: 0,
  u1Satz: null,
  u2Satz: 0,
  rvBefreit: false,
  pauschsteuer: true,
  personengruppe: "",
  beitragsgruppen: "",
  taetigkeitsschluessel: "",
  svNummer: "",
  statusfeststellung: "",
  eintritt: "",
  austritt: null,
  iban: "",
};

/** Tausendstel mit Komma: 500 → „0,5“, 950 → „0,95“ */
const alsZahl = (tausendstel: number) => (tausendstel / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 });

/** „0,5“ → 500 ohne Gleitkomma; null, wenn es keine Zahl mit höchstens drei Nachkommastellen ist */
export function parseTausendstel(text: string): number | null {
  const m = /^(\d+)(?:,(\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
}

const STEUERKLASSEN = ["I", "II", "III", "IV", "V", "VI"];

type Texte = Record<"monatsgehalt" | "zusatzbeitrag" | "pkvBasisbeitrag" | "pkvZuschuss" | "u1Satz" | "u2Satz" | "faktor" | "kinderfreibetraege", string>;

function texte(w: MitarbeiterWerte): Texte {
  return {
    monatsgehalt: w.monatsgehalt ? formatDecimal(w.monatsgehalt) : "",
    zusatzbeitrag: formatDecimal(w.zusatzbeitrag),
    pkvBasisbeitrag: formatDecimal(w.pkvBasisbeitrag),
    pkvZuschuss: formatDecimal(w.pkvZuschuss),
    u1Satz: w.u1Satz === null ? "" : formatDecimal(w.u1Satz),
    u2Satz: formatDecimal(w.u2Satz),
    faktor: alsZahl(w.faktor),
    kinderfreibetraege: alsZahl(w.kinderfreibetraege),
  };
}

/** Werte aus den Texten; die erste Beanstandung als Text */
function auswerten(w: MitarbeiterWerte, t: Texte): MitarbeiterWerte | string {
  const euro = (text: string, label: string, leerIstNull = true) => {
    if (leerIstNull && text.trim() === "") return 0;
    const n = parseEuro(text);
    return n === null || n < 0 ? `${label}: kein gültiger Betrag.` : n;
  };
  const werte = {
    monatsgehalt: euro(t.monatsgehalt, "Monatsgehalt", false),
    zusatzbeitrag: euro(t.zusatzbeitrag, "Zusatzbeitrag"),
    pkvBasisbeitrag: euro(t.pkvBasisbeitrag, "Beitrag zur privaten Basisabsicherung"),
    pkvZuschuss: euro(t.pkvZuschuss, "Zuschuss zur privaten Versicherung"),
    u2Satz: euro(t.u2Satz, "Umlage U2"),
    // Im Minijob nur die Teilnahme (Kästchen), die Sätze sind die der Minijob-Zentrale
    u1Satz: w.art !== "beschaeftigt" ? w.u1Satz : t.u1Satz.trim() === "" ? null : euro(t.u1Satz, "Umlage U1"),
    faktor: parseTausendstel(t.faktor) ?? "Faktor: eine Zahl wie 0,950.",
    kinderfreibetraege: parseTausendstel(t.kinderfreibetraege) ?? "Kinderfreibeträge: eine Zahl wie 0,5 oder 1.",
  };
  const fehler = Object.values(werte).find((v) => typeof v === "string");
  if (typeof fehler === "string") return fehler;
  return { ...w, ...(werte as Pick<MitarbeiterWerte, keyof typeof werte>) };
}

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <fieldset className="form-section">
      <legend>{titel}</legend>
      {children}
    </fieldset>
  );
}

export function MitarbeiterForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onError,
}: {
  initial: MitarbeiterWerte;
  submitLabel: string;
  busy: boolean;
  onSubmit: (werte: MitarbeiterWerte) => void;
  onError: (text: string) => void;
}) {
  const [w, setW] = useState(initial);
  const [t, setT] = useState(() => texte(initial));
  const set = <K extends keyof MitarbeiterWerte>(key: K, value: MitarbeiterWerte[K]) => setW((alt) => ({ ...alt, [key]: value }));
  const text = (key: keyof Texte) => ({ value: t[key], onChange: (e: { target: { value: string } }) => setT((alt) => ({ ...alt, [key]: e.target.value })) });
  const feld = (
    key:
      | "vorname"
      | "nachname"
      | "strasse"
      | "plz"
      | "ort"
      | "steuerId"
      | "krankenkasse"
      | "krankenkasseBetriebsnummer"
      | "personengruppe"
      | "beitragsgruppen"
      | "taetigkeitsschluessel"
      | "svNummer"
      | "iban",
  ) => ({
    value: w[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
  });
  const mitSv = w.art !== "ggf";
  const kasse = w.art === "beschaeftigt";

  function absenden(event: FormEvent) {
    event.preventDefault();
    const ergebnis = auswerten(w, t);
    if (typeof ergebnis === "string") onError(ergebnis);
    else onSubmit(ergebnis);
  }

  return (
    <form onSubmit={absenden} aria-label="Stammdaten des Mitarbeiters" className="card form-card">
      <Abschnitt titel="Person">
        <div className="form-row cols-2">
          <label className="field">
            Vorname
            <input {...feld("vorname")} required autoComplete="off" />
          </label>
          <label className="field">
            Nachname
            <input {...feld("nachname")} required autoComplete="off" />
          </label>
        </div>
        <label className="field">
          Straße und Hausnummer
          <input {...feld("strasse")} autoComplete="off" />
        </label>
        <div className="form-row cols-place">
          <label className="field">
            PLZ
            <input {...feld("plz")} inputMode="numeric" autoComplete="off" />
          </label>
          <label className="field">
            Ort
            <input {...feld("ort")} autoComplete="off" />
          </label>
          <label className="field">
            Geburtsdatum
            <input type="date" value={w.geburtsdatum} onChange={(e) => set("geburtsdatum", e.target.value)} required />
          </label>
        </div>
        <label className="field">
          IBAN für die Auszahlung
          <input {...feld("iban")} className="mono" autoComplete="off" />
        </label>
      </Abschnitt>

      <Abschnitt titel="Beschäftigung">
        <div className="form-row cols-2">
          <label className="field">
            Art der Beschäftigung
            <select value={w.art} onChange={(e) => set("art", e.target.value as Beschaeftigungsart)}>
              {Object.entries(BESCHAEFTIGUNGSARTEN).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Monatsgehalt brutto in Euro
            <input {...text("monatsgehalt")} inputMode="decimal" placeholder="0,00" required />
          </label>
          <label className="field">
            Eintritt
            <input type="date" value={w.eintritt} onChange={(e) => set("eintritt", e.target.value)} required />
          </label>
          <label className="field">
            Austritt (optional)
            <input type="date" value={w.austritt ?? ""} onChange={(e) => set("austritt", e.target.value || null)} />
          </label>
        </div>
        {w.art === "beschaeftigt" && (
          <p className="field-hint">
            Abrechnungen mit Sozialversicherung sind ein Entwurf zum Gegenprüfen, bis ein echter Fall gegen ein Lohnprogramm gerechnet ist.
          </p>
        )}
        {w.art === "ggf" && (
          <label className="field">
            Statusfeststellung (§ 7a SGB IV)
            <select value={w.statusfeststellung} onChange={(e) => set("statusfeststellung", e.target.value as MitarbeiterWerte["statusfeststellung"])}>
              <option value="">noch nicht beantragt</option>
              <option value="beantragt">beantragt, noch kein Ergebnis</option>
              <option value="versicherungsfrei">versicherungsfrei festgestellt</option>
              <option value="versicherungspflichtig">versicherungspflichtig festgestellt</option>
            </select>
          </label>
        )}
      </Abschnitt>

      <Abschnitt titel="Lohnsteuerabzugsmerkmale (ELStAM)">
        <div className="form-row cols-2">
          <label className="field">
            Steuer-ID
            <input {...feld("steuerId")} inputMode="numeric" className="mono" autoComplete="off" />
          </label>
          <label className="field">
            Steuerklasse
            <select value={w.steuerklasse} onChange={(e) => set("steuerklasse", Number(e.target.value))}>
              {STEUERKLASSEN.map((k, i) => (
                <option key={k} value={i + 1}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {w.steuerklasse === 4 && (
            <label className="field">
              Faktor (Steuerklasse IV)
              <input {...text("faktor")} inputMode="decimal" />
            </label>
          )}
          <label className="field">
            Kinderfreibeträge
            <input {...text("kinderfreibetraege")} inputMode="decimal" />
          </label>
          <label className="field">
            Kirchensteuermerkmal
            <select value={w.konfession ?? ""} onChange={(e) => set("konfession", (e.target.value || null) as Konfession | null)}>
              <option value="">keine Kirchensteuer</option>
              {Object.entries(KONFESSIONEN).map(([key, label]) => (
                <option key={key} value={key}>
                  {key} – {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Abschnitt>

      <Abschnitt titel="Kranken- und Pflegeversicherung">
        <div className="form-row cols-2">
          <label className="field">
            Krankenversicherung
            <select value={w.krankenversicherung} onChange={(e) => set("krankenversicherung", e.target.value as "gesetzlich" | "privat")}>
              <option value="gesetzlich">gesetzlich</option>
              <option value="privat">privat</option>
            </select>
          </label>
          {w.krankenversicherung === "gesetzlich" ? (
            <label className="field">
              Zusatzbeitrag der Kasse in Prozent
              <input {...text("zusatzbeitrag")} inputMode="decimal" />
            </label>
          ) : (
            <>
              <label className="field">
                Beitrag Basiskranken- und Pflegeversicherung im Monat in Euro
                <input {...text("pkvBasisbeitrag")} inputMode="decimal" />
              </label>
              <label className="field">
                Zuschuss des Arbeitgebers im Monat in Euro
                <input {...text("pkvZuschuss")} inputMode="decimal" />
              </label>
            </>
          )}
          <label className="field">
            Kinder unter 25
            <input type="number" min={0} max={20} value={w.kinderUnter25} onChange={(e) => set("kinderUnter25", Number(e.target.value) || 0)} />
          </label>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={w.kinderlosenzuschlag} onChange={(e) => set("kinderlosenzuschlag", e.target.checked)} />
          Zuschlag für Kinderlose (ab 23 Jahren ohne Elterneigenschaft)
        </label>
        {kasse && (
          <div className="form-row cols-2">
            <label className="field">
              Krankenkasse
              <input {...feld("krankenkasse")} autoComplete="off" />
            </label>
            <label className="field">
              Betriebsnummer der Krankenkasse
              <input {...feld("krankenkasseBetriebsnummer")} inputMode="numeric" className="mono" autoComplete="off" />
            </label>
            <label className="field">
              Umlage U1 in Prozent (leer ohne Teilnahme)
              <input {...text("u1Satz")} inputMode="decimal" />
            </label>
            <label className="field">
              Umlage U2 in Prozent
              <input {...text("u2Satz")} inputMode="decimal" />
            </label>
          </div>
        )}
      </Abschnitt>

      {mitSv && (
        <Abschnitt titel="Meldedaten der Sozialversicherung">
          <div className="form-row cols-2">
            <label className="field">
              Versicherungsnummer
              <input {...feld("svNummer")} className="mono uppercase" autoComplete="off" />
            </label>
            <label className="field">
              Personengruppe
              <input {...feld("personengruppe")} inputMode="numeric" className="mono" placeholder={w.art === "minijob" ? "109" : "101"} />
            </label>
            <label className="field">
              Beitragsgruppenschlüssel
              <input {...feld("beitragsgruppen")} inputMode="numeric" className="mono" placeholder={w.art === "minijob" ? "6500" : "1111"} />
            </label>
            <label className="field">
              Tätigkeitsschlüssel
              <input {...feld("taetigkeitsschluessel")} inputMode="numeric" className="mono" />
            </label>
          </div>
          {w.art === "minijob" && (
            <>
              <label className="checkbox">
                <input type="checkbox" checked={w.pauschsteuer} onChange={(e) => set("pauschsteuer", e.target.checked)} />
                Pauschsteuer 2 % (§ 40a Abs. 2 EStG), trägt der Arbeitgeber
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={w.rvBefreit} onChange={(e) => set("rvBefreit", e.target.checked)} />
                Von der Rentenversicherungspflicht befreit
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={w.u1Satz !== null} onChange={(e) => set("u1Satz", e.target.checked ? 0 : null)} />
                Arbeitgeber nimmt am U1-Verfahren teil (Sätze der Minijob-Zentrale)
              </label>
            </>
          )}
        </Abschnitt>
      )}

      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
