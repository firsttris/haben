import { RECHTSFORM_KEYS, RECHTSFORMEN, isKapitalgesellschaft, type Rechtsform } from "@haben/core";
import type { getCompany } from "../../server/functions/company.ts";
import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { Field } from "../Field.tsx";

type Firma = Awaited<ReturnType<typeof loadCompany>>;
type Sperren = Awaited<ReturnType<typeof getCompany>>["locks"];

/**
 * Klartext unter den Feldern Versteuerung und Kontenrahmen; ist das Feld gesperrt, folgt der genaue Grund aus settings-guard.ts.
 * Quelle: Ist-Versteuerung gestattet das Finanzamt auf Antrag (§ 20 UStG, docs/einrichtung.md: Versteuerung).
 */
const VERSTEUERUNG_HINT = "Ist: Die Umsatzsteuer zählt, wenn der Kunde zahlt. Soll: schon mit der Rechnung. Ist gestattet das Finanzamt auf Antrag.";
const KONTENRAHMEN_HINT =
  "Legt fest, auf welche Kontonummern Haben bucht (SKR03 oder SKR04). Nimm denselben wie bisher in Lexoffice oder bei deiner Steuerberatung.";

export function Steuern({
  company,
  locks,
  rechtsform,
  onRechtsform,
}: {
  company: Firma;
  locks: Sperren;
  rechtsform: Rechtsform;
  onRechtsform: (rechtsform: Rechtsform) => void;
}) {
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  return (
    <section className="form-section" aria-labelledby="company-tax">
      <h3 id="company-tax">Steuern</h3>
      <div className="form-row cols-2">
        <Field label="Steuernummer (wie auf dem Bescheid)">
          {(control) => <input {...control} name="steuernummer" defaultValue={company.steuernummer} placeholder="z. B. 21/815/08150" className="mono" />}
        </Field>
        <Field label="Finanzamt">{(control) => <input {...control} name="finanzamt" defaultValue={company.finanzamt} />}</Field>
      </div>
      <div className="form-row cols-2">
        <Field label="USt-IdNr.">
          {(control) => <input {...control} name="ustId" defaultValue={company.ustId} placeholder="DE123456789" className="mono" />}
        </Field>
        <Field
          label="Rechtsform"
          hint={
            locks.rechtsform ??
            (gesellschaft
              ? "Ohne EÜR, Einkommensteuer, Pauschalen und Privatanteile; Geld vom und an den Gesellschafter geht auf das Verrechnungskonto."
              : "Mit Privatkonten, Anlage EÜR und Einkommensteuer.")
          }
        >
          {(control) => (
            <select {...control} value={rechtsform} onChange={(e) => onRechtsform(e.target.value as Rechtsform)} disabled={Boolean(locks.rechtsform)}>
              {RECHTSFORM_KEYS.map((key) => (
                <option key={key} value={key}>
                  {RECHTSFORMEN[key]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {!gesellschaft && (
        <div className="form-row cols-2">
          <Field label="Einkunftsart (für die Anlage EÜR)">
            {(control) => (
              <select {...control} name="einkunftsart" defaultValue={company.einkunftsart ?? ""}>
                <option value="">Bitte wählen</option>
                <option value="selbstaendig">Selbständige Arbeit (freier Beruf, z. B. Entwickler, Berater)</option>
                <option value="gewerbe">Gewerbebetrieb</option>
              </select>
            )}
          </Field>
        </div>
      )}
      <Versteuerung company={company} locks={locks} />
      <Umsatzsteuer company={company} locks={locks} />
    </section>
  );
}

function Versteuerung({ company, locks }: { company: Firma; locks: Sperren }) {
  return (
    <div className="form-row cols-2">
      <Field label="Versteuerung" hint={locks.versteuerung ? `${VERSTEUERUNG_HINT} ${locks.versteuerung}` : VERSTEUERUNG_HINT}>
        {(control) => (
          <>
            {locks.versteuerung && <input type="hidden" name="versteuerung" value={company.versteuerung} />}
            <select
              {...control}
              name={locks.versteuerung ? undefined : "versteuerung"}
              defaultValue={company.versteuerung}
              disabled={Boolean(locks.versteuerung)}
            >
              <option value="ist">Ist (nach vereinnahmten Entgelten)</option>
              <option value="soll">Soll (nach vereinbarten Entgelten)</option>
            </select>
          </>
        )}
      </Field>
      <Field label="Kontenrahmen" hint={locks.kontenrahmen ? `${KONTENRAHMEN_HINT} ${locks.kontenrahmen}` : KONTENRAHMEN_HINT}>
        {(control) => (
          <>
            {/* Gesperrte Felder werden nicht mitgeschickt; der Wert kommt dann aus dem versteckten Feld */}
            {locks.kontenrahmen && <input type="hidden" name="kontenrahmen" value={company.kontenrahmen} />}
            <select
              {...control}
              name={locks.kontenrahmen ? undefined : "kontenrahmen"}
              defaultValue={company.kontenrahmen}
              disabled={Boolean(locks.kontenrahmen)}
            >
              <option value="SKR03">SKR03</option>
              <option value="SKR04">SKR04</option>
            </select>
          </>
        )}
      </Field>
    </div>
  );
}

function Umsatzsteuer({ company, locks }: { company: Firma; locks: Sperren }) {
  return (
    <>
      <div className="checkbox-hinted">
        <label className="checkbox">
          {/* Einschalten mitten im Jahr gesperrt; Ausschalten geht immer (Umsatzgrenze überschritten) */}
          <input
            type="checkbox"
            name="kleinunternehmer"
            defaultChecked={company.kleinunternehmer}
            disabled={Boolean(locks.kleinunternehmer) && !company.kleinunternehmer}
            aria-describedby="kleinunternehmer-hint"
          />
          <span>Kleinunternehmer nach § 19 UStG</span>
        </label>
        <span id="kleinunternehmer-hint" className="field-hint">
          Rechnungen ohne Umsatzsteuer, keine Voranmeldung, Belege ohne Vorsteuerabzug.{" "}
          {locks.kleinunternehmer && !company.kleinunternehmer
            ? locks.kleinunternehmer
            : company.kleinunternehmer
              ? "Ausschalten, sobald die Umsatzgrenze überschritten ist; ab dann gilt die Regelbesteuerung."
              : ""}
        </span>
      </div>
      <div className="checkbox-hinted">
        <label className="checkbox">
          <input type="checkbox" name="ohneVorsteuerabzug" defaultChecked={company.ohneVorsteuerabzug} aria-describedby="ohne-vorsteuerabzug-hint" />
          <span>Ohne Vorsteuerabzug (steuerfreie Umsätze nach § 4 UStG)</span>
        </label>
        <span id="ohne-vorsteuerabzug-hint" className="field-hint">
          Etwa bei Heilbehandlung oder Unterricht (§ 4 Nr. 14 und 21 UStG): Belege werden ohne Vorsteuer gebucht, die Steuer wird Teil der Ausgabe (§ 15 Abs. 2
          UStG). Am einzelnen Beleg änderbar; Rechnungen bleiben, wie sie sind.
        </span>
      </div>
    </>
  );
}
