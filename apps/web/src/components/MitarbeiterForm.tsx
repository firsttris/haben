import { BESCHAEFTIGUNGSARTEN, formatDecimal, KONFESSIONEN, parseEuro, type Beschaeftigungsart, type Konfession } from "@haben/core";
import { useState, type FormEvent, type ReactNode } from "react";
import { Field } from "./Field.tsx";

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

/**
 * Arten der Beschäftigung, die es in der Rechtsform gibt: einen Gesellschafter-Geschäftsführer nur in GmbH und UG, im
 * Einzelunternehmen ist der Lohn des Inhabers eine Entnahme. Eine schon gespeicherte Art bleibt wählbar.
 */
export function beschaeftigungsartenFor(gesellschaft: boolean, current?: Beschaeftigungsart): Beschaeftigungsart[] {
  return (Object.keys(BESCHAEFTIGUNGSARTEN) as Beschaeftigungsart[]).filter((art) => art !== "ggf" || gesellschaft || art === current);
}

export function MitarbeiterForm({
  initial,
  arten,
  submitLabel,
  busy,
  onSubmit,
  onError,
}: {
  initial: MitarbeiterWerte;
  arten: readonly Beschaeftigungsart[];
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
          <Field label="Vorname">{(control) => <input {...control} {...feld("vorname")} required autoComplete="off" />}</Field>
          <Field label="Nachname">{(control) => <input {...control} {...feld("nachname")} required autoComplete="off" />}</Field>
        </div>
        <Field label="Straße und Hausnummer">{(control) => <input {...control} {...feld("strasse")} autoComplete="off" />}</Field>
        <div className="form-row cols-place">
          <Field label="PLZ">{(control) => <input {...control} {...feld("plz")} inputMode="numeric" autoComplete="off" />}</Field>
          <Field label="Ort">{(control) => <input {...control} {...feld("ort")} autoComplete="off" />}</Field>
          <Field label="Geburtsdatum">
            {(control) => <input {...control} type="date" value={w.geburtsdatum} onChange={(e) => set("geburtsdatum", e.target.value)} required />}
          </Field>
        </div>
        <Field label="IBAN für die Auszahlung">{(control) => <input {...control} {...feld("iban")} className="mono" autoComplete="off" />}</Field>
      </Abschnitt>

      <Abschnitt titel="Beschäftigung">
        <div className="form-row cols-2">
          <Field label="Art der Beschäftigung">
            {(control) => (
              <select {...control} value={w.art} onChange={(e) => set("art", e.target.value as Beschaeftigungsart)}>
                {arten.map((key) => (
                  <option key={key} value={key}>
                    {BESCHAEFTIGUNGSARTEN[key]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Monatsgehalt brutto in Euro">
            {(control) => <input {...control} {...text("monatsgehalt")} inputMode="decimal" placeholder="0,00" required />}
          </Field>
          <Field label="Eintritt">
            {(control) => <input {...control} type="date" value={w.eintritt} onChange={(e) => set("eintritt", e.target.value)} required />}
          </Field>
          <Field label="Austritt (optional)">
            {(control) => <input {...control} type="date" value={w.austritt ?? ""} onChange={(e) => set("austritt", e.target.value || null)} />}
          </Field>
        </div>
        {w.art === "beschaeftigt" && (
          <p className="field-hint">
            Abrechnungen mit Sozialversicherung sind ein Entwurf zum Gegenprüfen, bis ein echter Fall gegen ein Lohnprogramm gerechnet ist.
          </p>
        )}
        {w.art === "ggf" && (
          <Field label="Statusfeststellung (§ 7a SGB IV)">
            {(control) => (
              <select
                {...control}
                value={w.statusfeststellung}
                onChange={(e) => set("statusfeststellung", e.target.value as MitarbeiterWerte["statusfeststellung"])}
              >
                <option value="">noch nicht beantragt</option>
                <option value="beantragt">beantragt, noch kein Ergebnis</option>
                <option value="versicherungsfrei">versicherungsfrei festgestellt</option>
                <option value="versicherungspflichtig">versicherungspflichtig festgestellt</option>
              </select>
            )}
          </Field>
        )}
      </Abschnitt>

      <Abschnitt titel="Lohnsteuerabzugsmerkmale (ELStAM)">
        <div className="form-row cols-2">
          <Field label="Steuer-ID">{(control) => <input {...control} {...feld("steuerId")} inputMode="numeric" className="mono" autoComplete="off" />}</Field>
          <Field label="Steuerklasse">
            {(control) => (
              <select {...control} value={w.steuerklasse} onChange={(e) => set("steuerklasse", Number(e.target.value))}>
                {STEUERKLASSEN.map((k, i) => (
                  <option key={k} value={i + 1}>
                    {k}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {w.steuerklasse === 4 && (
            <Field label="Faktor (Steuerklasse IV)">{(control) => <input {...control} {...text("faktor")} inputMode="decimal" />}</Field>
          )}
          <Field label="Kinderfreibeträge">{(control) => <input {...control} {...text("kinderfreibetraege")} inputMode="decimal" />}</Field>
          <Field label="Kirchensteuermerkmal">
            {(control) => (
              <select {...control} value={w.konfession ?? ""} onChange={(e) => set("konfession", (e.target.value || null) as Konfession | null)}>
                <option value="">keine Kirchensteuer</option>
                {Object.entries(KONFESSIONEN).map(([key, label]) => (
                  <option key={key} value={key}>
                    {key} – {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Abschnitt>

      <Abschnitt titel="Kranken- und Pflegeversicherung">
        <div className="form-row cols-2">
          <Field label="Krankenversicherung">
            {(control) => (
              <select {...control} value={w.krankenversicherung} onChange={(e) => set("krankenversicherung", e.target.value as "gesetzlich" | "privat")}>
                <option value="gesetzlich">gesetzlich</option>
                <option value="privat">privat</option>
              </select>
            )}
          </Field>
          {w.krankenversicherung === "gesetzlich" ? (
            <Field label="Zusatzbeitrag der Kasse in Prozent">{(control) => <input {...control} {...text("zusatzbeitrag")} inputMode="decimal" />}</Field>
          ) : (
            <>
              <Field label="Beitrag Basiskranken- und Pflegeversicherung im Monat in Euro">
                {(control) => <input {...control} {...text("pkvBasisbeitrag")} inputMode="decimal" />}
              </Field>
              <Field label="Zuschuss des Arbeitgebers im Monat in Euro">
                {(control) => <input {...control} {...text("pkvZuschuss")} inputMode="decimal" />}
              </Field>
            </>
          )}
          <Field label="Kinder unter 25">
            {(control) => (
              <input {...control} type="number" min={0} max={20} value={w.kinderUnter25} onChange={(e) => set("kinderUnter25", Number(e.target.value) || 0)} />
            )}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={w.kinderlosenzuschlag} onChange={(e) => set("kinderlosenzuschlag", e.target.checked)} />
          Zuschlag für Kinderlose (ab 23 Jahren ohne Elterneigenschaft)
        </label>
        {kasse && (
          <div className="form-row cols-2">
            <Field label="Krankenkasse">{(control) => <input {...control} {...feld("krankenkasse")} autoComplete="off" />}</Field>
            <Field label="Betriebsnummer der Krankenkasse">
              {(control) => <input {...control} {...feld("krankenkasseBetriebsnummer")} inputMode="numeric" className="mono" autoComplete="off" />}
            </Field>
            <Field label="Umlage U1 in Prozent (leer ohne Teilnahme)">{(control) => <input {...control} {...text("u1Satz")} inputMode="decimal" />}</Field>
            <Field label="Umlage U2 in Prozent">{(control) => <input {...control} {...text("u2Satz")} inputMode="decimal" />}</Field>
          </div>
        )}
      </Abschnitt>

      {mitSv && (
        <Abschnitt titel="Meldedaten der Sozialversicherung">
          <div className="form-row cols-2">
            <Field label="Versicherungsnummer">{(control) => <input {...control} {...feld("svNummer")} className="mono uppercase" autoComplete="off" />}</Field>
            <Field label="Personengruppe">
              {(control) => (
                <input {...control} {...feld("personengruppe")} inputMode="numeric" className="mono" placeholder={w.art === "minijob" ? "109" : "101"} />
              )}
            </Field>
            <Field label="Beitragsgruppenschlüssel">
              {(control) => (
                <input {...control} {...feld("beitragsgruppen")} inputMode="numeric" className="mono" placeholder={w.art === "minijob" ? "6500" : "1111"} />
              )}
            </Field>
            <Field label="Tätigkeitsschlüssel">
              {(control) => <input {...control} {...feld("taetigkeitsschluessel")} inputMode="numeric" className="mono" />}
            </Field>
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
