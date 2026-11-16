import { ANGABEN_FELDER } from "@firsttris/gobd-kern/verfahrensdoku";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { formatDate } from "../lib/format.ts";
import type { getProcedureDocument } from "../server/functions/verfahrensdoku.ts";
import { saveProcedureDetailsFn } from "../server/functions/verfahrensdoku.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Details = Awaited<ReturnType<typeof getProcedureDocument>>["details"];

/** Reihenfolge im Formular; Firma, Rechtsform und Anschrift kommen aus Einstellungen › Firma */
const FELDER = ["verantwortlich", "aufbewahrungsort", "papierbelege", "serverbetrieb", "datensicherung", "schluesselablage", "ergaenzungen"] as const;

/** Angaben zum Betrieb, die Haben nicht kennt; jede Änderung steht im Änderungsprotokoll */
export function ProcedureDetailsForm({ details }: { details: Details }) {
  const router = useRouter();
  const save = useServerFn(saveProcedureDetailsFn);
  const { busy, notice, run } = useAction();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(FELDER.map((name) => [name, String(form.get(name) ?? "")])) as Record<(typeof FELDER)[number], string>;
    if (await run(() => save({ data }), "Angaben gespeichert.")) await router.invalidate();
  }

  return (
    <form className="card stack procedure-form" id="angaben" aria-labelledby="procedure-form-heading" onSubmit={submit} noValidate>
      <div>
        <h2 id="procedure-form-heading">Angaben zum Betrieb</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Was Haben nicht wissen kann. Firma, Rechtsform und Anschrift kommen aus Einstellungen › Firma. Keine Passwörter oder Schlüssel eintragen, nur wo sie
          liegen. Jede Änderung steht im Änderungsprotokoll{details.updatedAt ? `; zuletzt geändert am ${formatDate(details.updatedAt)}` : ""}.
        </p>
      </div>
      {FELDER.map((name) => {
        const feld = ANGABEN_FELDER[name];
        return (
          <Field key={name} label={feld.label} hint={feld.hinweis}>
            {(control) => <textarea {...control} name={name} defaultValue={details[name]} rows={name === "ergaenzungen" ? 6 : 3} maxLength={feld.max} />}
          </Field>
        );
      })}
      <NoticeBanner notice={notice} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Angaben speichern
        </button>
      </div>
    </form>
  );
}
