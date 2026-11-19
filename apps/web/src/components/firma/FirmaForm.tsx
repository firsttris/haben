import { formatDecimal, formatHundredths, isKapitalgesellschaft, type Rechtsform } from "@haben/core";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useAction } from "../../lib/use-action.ts";
import { emailFehler, useSubmitCheck } from "../../lib/use-submit-check.ts";
import { saveCompany } from "../../server/functions/company.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { PrivatanteilVorgaben, privatanteilFehler, privatanteilTexte } from "../PrivatanteilVorgaben.tsx";
import { parseSkontoRows, toSkontoRows } from "../SkontoFields.tsx";
import { type FirmaAbschnitt, useOffeneAbschnitte } from "./EinklappAbschnitt.tsx";
import { Bankverbindung } from "./Bankverbindung.tsx";
import { firmaDaten } from "./firma-daten.ts";
import { Fremdwaehrung } from "./Fremdwaehrung.tsx";
import { Handelsregister } from "./Handelsregister.tsx";
import { dunningErrors, Mahnwesen } from "./Mahnwesen.tsx";
import { RechnungenAngebote } from "./RechnungenAngebote.tsx";
import { Anschrift, Unternehmen } from "./Stammdaten.tsx";
import { Steuern } from "./Steuern.tsx";

const route = getRouteApi("/_app/einstellungen");

/** Der Abschnitt, in dem das Feld mit diesem Schlüssel (siehe useSubmitCheck) steht; null, wo es keinen einklappbaren gibt */
const abschnittVonFeld = (feld: string): FirmaAbschnitt | null =>
  feld.startsWith("dunning-") ? "company-dunning" : feld.startsWith("privateShare-") ? "company-private" : null;

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
  const { abschnitt, aufklappen } = useOffeneAbschnitte(letterIssues.length > 0);
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
    if (mitFehler.length > 0) flushSync(() => aufklappen(mitFehler));
    if (!check()) return;
    const form = new FormData(event.currentTarget);
    const skonto = parseSkontoRows(skontoRows);
    void run(async () => {
      if (!skonto.valid) throw new Error("Skonto: je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben.");
      await save({ data: firmaDaten({ form, company, rechtsform, skonto: skonto.stufen, fees, privatanteile }) });
      await router.invalidate();
    }, "Firmendaten gespeichert.");
  }

  return (
    <form ref={checkScope} className="card form-card" onSubmit={onSubmit} aria-labelledby="company-heading" noValidate>
      <div className="form-card-head">
        <h2 id="company-heading">Firmendaten</h2>
        {issues.length > 0 && <div className="banner">Für ELSTER fehlt noch: {issues.join(", ")}.</div>}
      </div>

      <Unternehmen company={company} email={email} onEmail={setEmail} error={error} />

      <Anschrift company={company} />

      {gesellschaft && <Handelsregister company={company} letterIssues={letterIssues} {...abschnitt("company-register")} />}

      <Steuern company={company} locks={locks} rechtsform={rechtsform} onRechtsform={setRechtsform} />

      <Fremdwaehrung tageskurs={company.tageskurs} {...abschnitt("company-currency")} />

      <Bankverbindung company={company} />

      <RechnungenAngebote company={company} skontoRows={skontoRows} onSkonto={setSkontoRows} />

      {!gesellschaft && <PrivatanteilVorgaben texte={privatanteile} onChange={setPrivatanteile} error={error} {...abschnitt("company-private")} />}

      <Mahnwesen company={company} baseRate={baseRate} onBaseRate={setBaseRate} fees={fees} onFees={setFees} error={error} {...abschnitt("company-dunning")} />

      <NoticeBanner notice={notice} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}
