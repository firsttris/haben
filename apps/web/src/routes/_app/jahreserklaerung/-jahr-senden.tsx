import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { AbgabeVermerken } from "../../../components/jahreserklaerung/AbgabeVermerken.tsx";
import { MeinElsterWerte } from "../../../components/MeinElsterWerte.tsx";
import { elsterNotice, jahresergebnisFakt } from "../../../lib/elster.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getMeinElsterWerte, submitAnnualReturn } from "../../../server/functions/annual.ts";
import type { Data } from "../../../components/jahreserklaerung/typen.ts";

export type Form = "ust" | "euer" | "est";

export const FORM_LABEL = {
  ust: "Umsatzsteuererklärung",
  euer: "Anlage EÜR",
  est: "Einkommensteuererklärung",
  kst: "Körperschaftsteuererklärung",
  gewst: "Gewerbesteuererklärung",
} as const;

export function SubmitPanel({
  form,
  data,
  blocked,
  sent,
  submitted,
}: {
  form: Form;
  data: Data;
  blocked: boolean;
  sent: boolean;
  submitted: Data["ust"]["submitted"];
}) {
  const router = useRouter();
  const submit = useServerFn(submitAnnualReturn);
  const loadWerte = useServerFn(getMeinElsterWerte);
  const { busy, notice, setNotice, run } = useAction();
  const berechnet = form === "ust" ? data.ust.abschluss : form === "euer" ? data.euer.gewinn : 0;
  // Die Zahl der Tabelle: mit Vermerk der erklärte Betrag (der Dialog fehlt dann ohnehin)
  const ergebnis = jahresergebnisFakt(form, form === "ust" ? data.ust.anzeige.abschluss : form === "euer" ? data.euer.gewinn : data.est.gewinn);

  return (
    <div className="stack sticky-panel">
      {/* Mit Vermerk ist die Erklärung von außen abgegeben; ein ausgegrautes Übermittlungs-Panel sagt dazu nichts (#1080) */}
      {!submitted && (
        <ElsterSubmit
          setup={data}
          title={`${FORM_LABEL[form]} übermitteln`}
          className="card"
          ready={!blocked}
          busy={busy}
          notice={notice}
          lockedHint={sent ? "Schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal." : undefined}
          confirmTitle={`${FORM_LABEL[form]} ${data.year} verbindlich senden?`}
          confirmFacts={[
            { label: form === "euer" ? "Meldung" : "Steuerart", value: FORM_LABEL[form] },
            { label: "Zeitraum", value: String(data.year) },
            ...(ergebnis ? [ergebnis] : []),
          ]}
          confirmText={`Die ${FORM_LABEL[form]} ${data.year} geht verbindlich an das Finanzamt.`}
          footer="Erst mit „Nur prüfen“ oder einer Testübermittlung prüft ERiC die Daten gegen die Vorgaben des Jahres. Die PIN wird nicht gespeichert."
          onSubmit={(kind, pin) =>
            run(async () => {
              const result = await submit({ data: { form, year: data.year, kind, pin } });
              setNotice(elsterNotice(kind, result, "Übermittelt."));
              await router.invalidate();
            })
          }
        />
      )}
      <AbgabeVermerken art={form} year={data.year} today={data.today} berechnet={berechnet} vermerkt={submitted} />
      {!data.herstellerIdConfigured && !sent && !submitted && (
        <MeinElsterWerte load={() => loadWerte({ data: { form, year: data.year } })} label={`${FORM_LABEL[form]} ${data.year}`} blocked={blocked} />
      )}
    </div>
  );
}
