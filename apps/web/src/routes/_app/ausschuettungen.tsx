import { currentYear, isKapitalgesellschaft } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { getAusschuettungen } from "../../server/functions/ausschuettung.ts";
import styles from "../../styles/auswertungen.css?url";
import { Field } from "../../components/Field.tsx";
import { NeueAusschuettung } from "./-ausschuettungen-neu.tsx";
import { AusschuettungCard } from "./-ausschuettungen-teile.tsx";

export const Route = createFileRoute("/_app/ausschuettungen")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional() }),
  loaderDeps: ({ search }) => ({ jahr: search.jahr ?? currentYear() }),
  loader: ({ deps }) => getAusschuettungen({ data: deps.jahr }),
  head: () => ({ meta: [{ title: "Ausschüttungen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AusschuettungenPage,
});

function AusschuettungenPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const thisYear = currentYear();
  const years = [...new Set([data.year, thisYear, thisYear - 1, thisYear - 2])].sort((a, b) => b - a);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Gewinnverwendung</div>
          <h1>Ausschüttungen {data.year}</h1>
        </div>
        <Field label="Jahr">
          {(control) => (
            <select {...control} value={data.year} onChange={(e) => navigate({ to: "/ausschuettungen", search: { jahr: Number(e.target.value) } })}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {isKapitalgesellschaft(data.rechtsform) ? (
        <div className="stack" style={{ gap: 24 }}>
          <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
            Eine GmbH oder UG schüttet ihren Gewinn mit einem Gewinnverwendungsbeschluss aus. Haben bucht ihn, behält Kapitalertragsteuer, Soli und
            Kirchensteuer je Gesellschafter ein und meldet sie über ELSTER an. Gesellschafter, Anteile und Kirchensteuerabzugsmerkmale stehen unter{" "}
            <Link to="/jahreserklaerung">Jahreserklärung › Angaben zu den Erklärungen</Link>.
          </p>
          <NeueAusschuettung />
          {data.ausschuettungen.length === 0 ? (
            <p className="muted" style={{ maxWidth: 760 }}>
              Noch keine Ausschüttung, die in {data.year} bei den Gesellschaftern ankommt (steuerlich: Zufluss). Beispiel: Beschluss am 30.06.{data.year} über
              20.000 € aus dem Gewinn {data.year - 1}; ohne Auszahlungstag im Beschluss gilt steuerlich der 01.07.{data.year} als Zufluss (§ 44 Abs. 2 Satz 2
              EStG).
            </p>
          ) : (
            data.ausschuettungen.map((a) => <AusschuettungCard key={a.id} data={data} a={a} />)
          )}
        </div>
      ) : (
        <p className="muted" style={{ maxWidth: 760 }}>
          Gewinnausschüttungen gibt es für GmbH und UG. Im Einzelunternehmen entnimmst du Gewinn als Privatentnahme.
        </p>
      )}
    </>
  );
}
