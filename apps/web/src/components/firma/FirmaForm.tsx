import {
  BUNDESLAENDER,
  RECHTSFORM_KEYS,
  RECHTSFORMEN,
  formatDecimal,
  formatHundredths,
  isKapitalgesellschaft,
  parseBaseRate,
  parseEuro,
  type Bundesland,
  type Rechtsform,
} from "@haben/core";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { FORMAT_LABEL, FORMATS } from "../../lib/invoice.ts";
import { useAction } from "../../lib/use-action.ts";
import { emailFehler, useSubmitCheck } from "../../lib/use-submit-check.ts";
import { saveCompany } from "../../server/functions/company.ts";
import { Field } from "../Field.tsx";
import { FormattedTextarea } from "../FormattedTextarea.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { PrivatanteilVorgaben, privatanteilFehler, privatanteilTexte, privatanteilWerte } from "../PrivatanteilVorgaben.tsx";
import { parseSkontoRows, SkontoFields, toSkontoRows } from "../SkontoFields.tsx";
import { type FirmaAbschnitt, type OffeneAbschnitte, useAnkerAufklappen } from "./EinklappAbschnitt.tsx";
import { Bankverbindung } from "./Bankverbindung.tsx";
import { Fremdwaehrung } from "./Fremdwaehrung.tsx";
import { Handelsregister } from "./Handelsregister.tsx";
import { dunningErrors, Mahnwesen } from "./Mahnwesen.tsx";

const route = getRouteApi("/_app/einstellungen");

/** Der Abschnitt, in dem das Feld mit diesem Schlüssel (siehe useSubmitCheck) steht; null, wo es keinen einklappbaren gibt */
const abschnittVonFeld = (feld: string): FirmaAbschnitt | null =>
  feld.startsWith("dunning-") ? "company-dunning" : feld.startsWith("privateShare-") ? "company-private" : null;

/**
 * Klartext unter den Feldern Versteuerung und Kontenrahmen; ist das Feld gesperrt, folgt der genaue Grund aus settings-guard.ts.
 * Quelle: Ist-Versteuerung gestattet das Finanzamt auf Antrag (§ 20 UStG, docs/einrichtung.md: Versteuerung).
 */
const VERSTEUERUNG_HINT = "Ist: Die Umsatzsteuer zählt, wenn der Kunde zahlt. Soll: schon mit der Rechnung. Ist gestattet das Finanzamt auf Antrag.";
const KONTENRAHMEN_HINT =
  "Legt fest, auf welche Kontonummern Haben bucht (SKR03 oder SKR04). Nimm denselben wie bisher in Lexoffice oder bei deiner Steuerberatung.";

export function CompanyForm() {
  const { company, issues, letterIssues, locks } = route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(saveCompany);
  const { busy, notice, run } = useAction();
  // Steuert, was nur ein Einzelunternehmen hat: Einkunftsart der EÜR und Privatanteile
  const [rechtsform, setRechtsform] = useState<Rechtsform>(company.rechtsform);
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(company.skonto));
  const [baseRate, setBaseRate] = useState(company.dunning.baseRate === null ? "" : formatHundredths(company.dunning.baseRate));
  const fee = (level: "1" | "2" | "3") => (company.dunning.fees[level] ? formatDecimal(company.dunning.fees[level]) : "");
  const [fees, setFees] = useState({ "1": fee("1"), "2": fee("2"), "3": fee("3") });
  const [email, setEmail] = useState(company.email);
  const [privatanteile, setPrivatanteile] = useState(() => privatanteilTexte(company.privateShares));
  // Fehlen Pflichtangaben der Gesellschaft, steht das Handelsregister offen, damit der Hinweis darin nicht verborgen bleibt
  const [offen, setOffen] = useState<OffeneAbschnitte>({
    "company-register": letterIssues.length > 0,
    "company-currency": false,
    "company-private": false,
    "company-dunning": false,
  });
  const umschalten = (id: FirmaAbschnitt) => (neu: boolean) => setOffen((aktuell) => ({ ...aktuell, [id]: neu }));
  useAnkerAufklappen(setOffen);
  const fehler = {
    email: emailFehler(email),
    ...dunningErrors(baseRate, fees),
    ...privatanteilFehler(privatanteile, gesellschaft),
  };
  const { form: checkScope, error, check } = useSubmitCheck(fehler);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Vor der Prüfung aufklappen: In einem zugeklappten Abschnitt fände der Fokus das Feld mit dem Fehler nicht
    const mitFehler = Object.entries(fehler).flatMap(([feld, text]) => (text ? (abschnittVonFeld(feld) ?? []) : []));
    if (mitFehler.length > 0) flushSync(() => setOffen((aktuell) => ({ ...aktuell, ...Object.fromEntries(mitFehler.map((id) => [id, true])) })));
    if (!check()) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const skonto = parseSkontoRows(skontoRows);
    void run(async () => {
      if (!skonto.valid) throw new Error("Skonto: je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben.");
      await save({
        data: {
          name: text("name"),
          rechtsform,
          // Ohne Kapitalgesellschaft stehen die Felder nicht im Formular; gespeicherte Angaben bleiben
          sitz: gesellschaft ? text("sitz") : company.sitz,
          registergericht: gesellschaft ? text("registergericht") : company.registergericht,
          registernummer: gesellschaft ? text("registernummer") : company.registernummer,
          geschaeftsfuehrer: gesellschaft ? text("geschaeftsfuehrer") : company.geschaeftsfuehrer,
          aufsichtsratVorsitz: gesellschaft ? text("aufsichtsratVorsitz") : company.aufsichtsratVorsitz,
          strasse: text("strasse"),
          plz: text("plz"),
          ort: text("ort"),
          email: text("email"),
          steuernummer: text("steuernummer"),
          ustId: text("ustId").toUpperCase().replace(/\s/g, ""),
          finanzamt: text("finanzamt"),
          bundesland: (text("bundesland") || null) as Bundesland | null,
          versteuerung: text("versteuerung") === "soll" ? "soll" : "ist",
          telefon: text("telefon"),
          bank: text("bank"),
          iban: text("iban").toUpperCase().replace(/\s/g, ""),
          bic: text("bic").toUpperCase().replace(/\s/g, ""),
          kontoinhaber: text("kontoinhaber"),
          glaeubigerId: text("glaeubigerId"),
          kontenrahmen: text("kontenrahmen") === "SKR04" ? "SKR04" : "SKR03",
          paymentTermDays: Number(text("paymentTermDays") || 14),
          skonto: skonto.stufen,
          defaultFormat: (text("defaultFormat") || "zugferd") as "zugferd" | "xrechnung-cii" | "xrechnung-ubl",
          invoiceIntro: text("invoiceIntro"),
          quoteIntro: text("quoteIntro"),
          kleinunternehmer: form.get("kleinunternehmer") === "on",
          foundedOn: text("foundedOn") || null,
          ohneVorsteuerabzug: form.get("ohneVorsteuerabzug") === "on",
          tageskurs: form.get("tageskurs") === "on",
          einkunftsart: text("einkunftsart") === "gewerbe" ? "gewerbe" : text("einkunftsart") === "selbstaendig" ? "selbstaendig" : null,
          taetigkeit: text("taetigkeit"),
          dunning: {
            // Geprüft mit baseRateError; leer heißt keine Verzugszinsen
            baseRate: text("dunning-baseRate").trim() ? parseBaseRate(text("dunning-baseRate")) : null,
            fees: {
              "1": parseEuro(fees["1"] || "0") ?? 0,
              "2": parseEuro(fees["2"] || "0") ?? 0,
              "3": parseEuro(fees["3"] || "0") ?? 0,
            },
            deadlineDays: Number(text("dunning-deadlineDays") || 10),
            autoBaseRate: form.get("dunning-autoBaseRate") === "on",
          },
          privateShares: privatanteilWerte(privatanteile, gesellschaft),
        },
      });
      await router.invalidate();
    }, "Firmendaten gespeichert.");
  }

  return (
    <form ref={checkScope} className="card form-card" onSubmit={onSubmit} aria-labelledby="company-heading" noValidate>
      <div className="form-card-head">
        <h2 id="company-heading">Firmendaten</h2>
        {issues.length > 0 && <div className="banner">Für ELSTER fehlt noch: {issues.join(", ")}.</div>}
      </div>

      <section className="form-section" aria-labelledby="company-basics">
        <h3 id="company-basics">Unternehmen</h3>
        <div className="form-row cols-2">
          <Field label="Name">{(control) => <input {...control} name="name" defaultValue={company.name} autoComplete="organization" />}</Field>
          <Field label="Art des Betriebs (Anlage EÜR) bzw. Gegenstand des Unternehmens">
            {(control) => <input {...control} name="taetigkeit" defaultValue={company.taetigkeit} placeholder="z. B. Softwareentwicklung" maxLength={100} />}
          </Field>
        </div>
        <div className="form-row cols-2">
          <Field label="E-Mail" error={error("email")}>
            {(control) => <input {...control} name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
          </Field>
          <Field label="Telefon (Pflicht für XRechnung)">
            {(control) => <input {...control} name="telefon" type="tel" defaultValue={company.telefon} autoComplete="tel" />}
          </Field>
        </div>
        <Field label="Gründungsdatum" hint="Datum, an dem du deine unternehmerische Tätigkeit aufgenommen hast.">
          {(control) => <input {...control} name="foundedOn" type="date" min="0001-01-01" defaultValue={company.foundedOn ?? ""} />}
        </Field>
      </section>

      <section className="form-section" aria-labelledby="company-address">
        <h3 id="company-address">Anschrift</h3>
        <Field label="Straße und Hausnummer">
          {(control) => <input {...control} name="strasse" defaultValue={company.strasse} autoComplete="street-address" />}
        </Field>
        <div className="form-row cols-place">
          <Field label="PLZ">{(control) => <input {...control} name="plz" defaultValue={company.plz} inputMode="numeric" autoComplete="postal-code" />}</Field>
          <Field label="Ort">{(control) => <input {...control} name="ort" defaultValue={company.ort} autoComplete="address-level2" />}</Field>
          <Field label="Bundesland">
            {(control) => (
              <select {...control} name="bundesland" defaultValue={company.bundesland ?? ""}>
                <option value="">Bitte wählen</option>
                {Object.entries(BUNDESLAENDER).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </section>

      {gesellschaft && (
        <Handelsregister company={company} letterIssues={letterIssues} offen={offen["company-register"]} onOffen={umschalten("company-register")} />
      )}

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
              <select {...control} value={rechtsform} onChange={(e) => setRechtsform(e.target.value as Rechtsform)} disabled={Boolean(locks.rechtsform)}>
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
            Etwa bei Heilbehandlung oder Unterricht (§ 4 Nr. 14 und 21 UStG): Belege werden ohne Vorsteuer gebucht, die Steuer wird Teil der Ausgabe (§ 15 Abs.
            2 UStG). Am einzelnen Beleg änderbar; Rechnungen bleiben, wie sie sind.
          </span>
        </div>
      </section>

      <Fremdwaehrung tageskurs={company.tageskurs} offen={offen["company-currency"]} onOffen={umschalten("company-currency")} />

      <Bankverbindung company={company} />

      <section className="form-section" aria-labelledby="company-invoices">
        <h3 id="company-invoices">Rechnungen und Angebote</h3>
        <div className="form-row cols-2">
          <Field label="Standard-Zahlungsziel in Tagen">
            {(control) => <input {...control} name="paymentTermDays" inputMode="numeric" defaultValue={company.paymentTermDays} />}
          </Field>
          <Field label="Standardformat für Rechnungen">
            {(control) => (
              <select {...control} name="defaultFormat" defaultValue={company.defaultFormat}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <SkontoFields
          id="company-skonto"
          rows={skontoRows}
          onChange={setSkontoRows}
          hint="Vorgabe für neue Rechnungen, z. B. 2 % bei Zahlung innerhalb von 10 Tagen; am Kunden und in der Rechnung änderbar. Die Frist zählt ab dem Rechnungsdatum und endet spätestens mit dem Zahlungsziel."
        />
        <div className="form-row cols-2">
          <Field label="Standard-Einleitung für Rechnungen" describedBy="intro-hint">
            {(control) => <FormattedTextarea {...control} name="invoiceIntro" rows={3} maxLength={2000} defaultValue={company.invoiceIntro} />}
          </Field>
          <Field label="Standard-Einleitung für Angebote" describedBy="intro-hint">
            {(control) => <FormattedTextarea {...control} name="quoteIntro" rows={3} maxLength={2000} defaultValue={company.quoteIntro} />}
          </Field>
        </div>
        <p id="intro-hint" className="field-hint">
          Steht in neuen Rechnungen und Angeboten als Einleitung über den Positionen und lässt sich dort anpassen. Rechnungen und Angebote, die es schon gibt,
          ändern sich nicht. Leer = keine Einleitung.
        </p>
      </section>

      {!gesellschaft && (
        <PrivatanteilVorgaben
          texte={privatanteile}
          onChange={setPrivatanteile}
          error={error}
          offen={offen["company-private"]}
          onOffen={umschalten("company-private")}
        />
      )}

      <Mahnwesen
        company={company}
        baseRate={baseRate}
        onBaseRate={setBaseRate}
        fees={fees}
        onFees={setFees}
        error={error}
        offen={offen["company-dunning"]}
        onOffen={umschalten("company-dunning")}
      />

      <NoticeBanner notice={notice} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}
