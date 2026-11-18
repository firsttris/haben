import { isKapitalgesellschaft } from "@haben/core";
import { useRouter, getRouteApi } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { useAction } from "../../lib/use-action.ts";
import { RELIGIONEN } from "../../lib/religion.ts";
import type { TaxpayerPerson } from "../../server/db/schema.ts";
import { saveTaxpayerData } from "../../server/functions/company.ts";
import { Field } from "../../components/Field.tsx";

const route = getRouteApi("/_app/einstellungen");

export type PersonKey = "a" | "b";

export function PersonFields({ prefix, person }: { prefix: PersonKey; person: TaxpayerPerson | undefined }) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <>
      <div className="form-row cols-2">
        <Field label="Anrede">
          {(control) => (
            <select {...control} name={id("anrede")} defaultValue={person?.anrede ?? "Herrn"}>
              <option value="Herrn">Herr</option>
              <option value="Frau">Frau</option>
            </select>
          )}
        </Field>
        <Field label="Steuer-ID">
          {(control) => (
            <input
              {...control}
              name={id("idnr")}
              inputMode="numeric"
              defaultValue={person?.idnr ?? ""}
              placeholder="11 Ziffern"
              autoComplete="off"
              className="mono"
            />
          )}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Vorname">{(control) => <input {...control} name={id("vorname")} defaultValue={person?.vorname ?? ""} />}</Field>
        <Field label="Nachname">{(control) => <input {...control} name={id("name")} defaultValue={person?.name ?? ""} />}</Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Geburtsdatum">
          {(control) => <input {...control} name={id("geburtsdatum")} type="date" defaultValue={person?.geburtsdatum ?? ""} />}
        </Field>
        <Field label="Religion">
          {(control) => (
            <select {...control} name={id("religion")} defaultValue={person?.religion ?? "11"}>
              {RELIGIONEN.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Ausgeübter Beruf">
        {(control) => <input {...control} name={id("beruf")} defaultValue={person?.beruf ?? ""} placeholder="z. B. IT-Berater" />}
      </Field>
    </>
  );
}

/**
 * Persönliche Angaben für ELSTER: Nachrichten, Postfach, Bankverbindung ändern, im Einzelunternehmen auch die
 * Einkommensteuererklärung. Veranlagung und Ehegatte gibt es nur dort; bei GmbH und UG bleiben gespeicherte Werte, wie sie sind.
 */
export function TaxpayerForm() {
  const { company } = route.useLoaderData();
  const taxpayer = company.taxpayer;
  const istPerson = !isKapitalgesellschaft(company.rechtsform);
  const router = useRouter();
  const save = useServerFn(saveTaxpayerData);
  const [veranlagung, setVeranlagung] = useState(taxpayer.veranlagung ?? "einzel");
  const { busy, notice, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const person = (key: PersonKey) => {
      if (!text(`${key}-idnr`) && !text(`${key}-vorname`) && !text(`${key}-name`)) return undefined;
      return {
        anrede: text(`${key}-anrede`) === "Frau" ? ("Frau" as const) : ("Herrn" as const),
        idnr: text(`${key}-idnr`),
        vorname: text(`${key}-vorname`),
        name: text(`${key}-name`),
        geburtsdatum: text(`${key}-geburtsdatum`),
        religion: text(`${key}-religion`) || "11",
        beruf: text(`${key}-beruf`),
      };
    };
    void run(async () => {
      const zusammen = veranlagung === "zusammen";
      await save({
        data: istPerson
          ? {
              a: person("a"),
              b: zusammen ? person("b") : undefined,
              veranlagung,
              verheiratetSeit: zusammen && text("verheiratetSeit") ? text("verheiratetSeit") : undefined,
              // Nur true ablegen: false wirkt in fristen.ts wie ein fehlendes Feld, ein false hätte dort keine Bedeutung
              keineVorauszahlungen: form.get("keineVorauszahlungen") === "on" ? true : undefined,
            }
          : { ...taxpayer, a: person("a") },
      });
      await router.invalidate();
    }, "Persönliche Angaben gespeichert.");
  }

  return (
    <form className="card form-card" onSubmit={onSubmit} aria-labelledby="taxpayer-heading">
      <div className="form-card-head">
        <h2 id="taxpayer-heading">Persönliche Angaben</h2>
        <p className="small muted">
          {istPerson
            ? "Für die Änderung der Bankverbindung und die Einkommensteuererklärung über ELSTER."
            : "Für Nachrichten an das Finanzamt, das Postfach und die Änderung der Bankverbindung über ELSTER."}
        </p>
      </div>
      <section className="form-section" aria-labelledby="taxpayer-a">
        <h3 id="taxpayer-a">Steuerpflichtige Person</h3>
        <PersonFields prefix="a" person={taxpayer.a} />
      </section>
      {istPerson && (
        <>
          <fieldset className="form-section">
            <legend>Veranlagung</legend>
            <div className="form-row cols-2">
              <Field label="Art">
                {(control) => (
                  <select {...control} value={veranlagung} onChange={(e) => setVeranlagung(e.target.value === "zusammen" ? "zusammen" : "einzel")}>
                    <option value="einzel">Einzelveranlagung</option>
                    <option value="zusammen">Zusammenveranlagung mit Ehegatten</option>
                  </select>
                )}
              </Field>
              {veranlagung === "zusammen" && (
                <Field label="Verheiratet seit">
                  {(control) => <input {...control} name="verheiratetSeit" type="date" defaultValue={taxpayer.verheiratetSeit ?? ""} />}
                </Field>
              )}
            </div>
            {taxpayer.a && (
              <div className="checkbox-hinted">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="keineVorauszahlungen"
                    defaultChecked={taxpayer.keineVorauszahlungen ?? false}
                    aria-describedby="keine-vorauszahlungen-hint"
                  />
                  <span>Keine Einkommensteuer-Vorauszahlungen festgesetzt</span>
                </label>
                <span id="keine-vorauszahlungen-hint" className="field-hint">
                  Ohne Haken steht je Quartal ein Hinweis im Fristenkalender. Das ist nur eine Erinnerung: Ob und wie viel zu zahlen ist, steht im
                  Vorauszahlungsbescheid.
                </span>
              </div>
            )}
          </fieldset>
          {veranlagung === "zusammen" && (
            <fieldset className="form-section">
              <legend>Ehegatte (Person B)</legend>
              <PersonFields prefix="b" person={taxpayer.b} />
            </fieldset>
          )}
        </>
      )}
      <NoticeBanner notice={notice} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}
