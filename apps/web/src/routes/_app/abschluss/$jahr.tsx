import { currentYear } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BilanzGuv } from "../../../components/BilanzGuv.tsx";
import { Ebilanz } from "../../../components/Ebilanz.tsx";
import { Hinterlegung } from "../../../components/Hinterlegung.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { KapgSteuern } from "../../../components/KapgSteuern.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { Restlaufzeiten } from "../../../components/Restlaufzeiten.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { closeYearFn, getJahresabschluss } from "../../../server/functions/abschluss.ts";
import styles from "../../../styles/auswertungen.css?url";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { Field } from "../../../components/Field.tsx";

export const Route = createFileRoute("/_app/abschluss/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getJahresabschluss({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Jahresabschluss ${loaderData?.year ?? ""} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AbschlussPage,
});

type Data = Awaited<ReturnType<typeof getJahresabschluss>>;
type Kapitalgesellschaft = Extract<Data, { kapitalgesellschaft: true }>;

function AbschlussPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const thisYear = currentYear();
  const years = [...new Set([data.year, thisYear, thisYear - 1, thisYear - 2])].sort((a, b) => b - a);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jahresabschluss</div>
          <h1>Geschäftsjahr {data.year}</h1>
        </div>
        <Field label="Jahr">
          {(control) => (
            <select {...control} value={data.year} onChange={(e) => navigate({ to: "/abschluss/$jahr", params: { jahr: e.target.value } })}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {data.kapitalgesellschaft ? (
        <Report data={data} />
      ) : (
        <p className="muted" style={{ maxWidth: 760 }}>
          Einen Jahresabschluss mit Bilanz gibt es für GmbH und UG. Im Einzelunternehmen ermittelt Haben den Gewinn mit der Anlage EÜR unter{" "}
          <Link to="/jahreserklaerung">Jahreserklärung</Link>.
        </p>
      )}
    </>
  );
}

function Report({ data }: { data: Kapitalgesellschaft }) {
  const { report } = data;
  const router = useRouter();
  const close = useServerFn(closeYearFn);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const blocking = data.issues.filter((i) => i.tone === "fehler");

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="banner banner-info" role="note">
        <Icon name="info" />
        <span>
          Entwurf für die Steuerberatung: Bilanz und GuV einer Kleinstkapitalgesellschaft (§ 267a HGB) aus den Buchungen, die Posten nach dem
          DATEV-Kontenrahmen. Rückstellungen, Abgrenzungen und Steuern bucht ihr vorher als manuelle Buchung; die Bewertung bleibt Sache der Steuerberatung.
        </span>
      </div>

      {data.issues.length > 0 && (
        <section className="card" aria-labelledby="issues-heading">
          <h2 id="issues-heading" style={{ marginTop: 0 }}>
            Offene Punkte
          </h2>
          <ul className="stack" style={{ margin: 0, gap: 4 }}>
            {data.issues.map((i) => (
              <li key={i.text}>
                {i.tone === "fehler" ? "Vor dem Abschluss: " : ""}
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <BilanzGuv year={data.year} report={report} names={data.names} kontoLinks vermerke={data.vermerke} />

      {data.restlaufzeiten && <Restlaufzeiten year={data.year} data={data.restlaufzeiten} />}

      {data.steuern && <KapgSteuern year={data.year} data={data.steuern} closed={Boolean(data.status)} />}

      <section className="card" aria-labelledby="close-heading">
        <h2 id="close-heading" style={{ marginTop: 0 }}>
          Jahr abschließen
        </h2>
        {data.status ? (
          <p style={{ margin: 0 }}>
            Abgeschlossen am {formatDateTime(data.status.closedAt)} mit {data.status.entries} Buchungen.{" "}
            {data.status.intact ? (
              "Die Buchungen sind seitdem unverändert."
            ) : (
              <strong>Die Buchungen des Jahres wurden seitdem an Haben vorbei geändert.</strong>
            )}
          </p>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0, maxWidth: 760 }}>
              Danach nimmt das Jahr keine Buchung mehr an, auch keine Korrektur; das lässt sich nicht rückgängig machen. Haben hält Zahl und Prüfwert der
              Buchungen fest und zeigt hier, ob sie unverändert sind. Schließe erst ab, wenn die Steuerberatung den Abschluss freigegeben hat.
            </p>
            <button type="button" className="btn btn-primary" disabled={busy || blocking.length > 0} onClick={() => setConfirming(true)}>
              {data.year} abschließen
            </button>
            <ConfirmDialog
              open={confirming}
              title={`Jahr ${data.year} endgültig abschließen?`}
              confirmLabel={`${data.year} abschließen`}
              danger
              acknowledge="Mir ist klar, dass das Jahr danach nicht mehr änderbar ist."
              onConfirm={() =>
                void run(async () => {
                  await close({ data: { year: data.year } });
                  await router.invalidate();
                }, `Das Jahr ${data.year} ist abgeschlossen.`)
              }
              onClose={() => setConfirming(false)}
            >
              <p>Danach nimmt das Jahr keine Buchung mehr an, auch keine Korrektur; das lässt sich nicht rückgängig machen.</p>
            </ConfirmDialog>
          </>
        )}
        <NoticeBanner notice={notice} />
      </section>

      {data.ebilanz && <Ebilanz year={data.year} ebilanz={data.ebilanz} setup={data.elster} closed={Boolean(data.status)} />}

      {data.hinterlegung && <Hinterlegung year={data.year} stand={data.hinterlegung} closed={Boolean(data.status)} />}
    </div>
  );
}
