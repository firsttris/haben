import { currentYear } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { Icon } from "../../components/Icon.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { PasskeysCard } from "../../components/PasskeysCard.tsx";
import { downloadFrom } from "../../lib/download.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { getSteuerberatungStart } from "../../server/functions/zugang.ts";

/** Startseite der Steuerberatung: was sich seit dem letzten Besuch geändert hat, Exporte, eigener Zugang */
export const Route = createFileRoute("/_app/steuerberatung")({
  loader: () => getSteuerberatungStart(),
  head: () => ({ meta: [{ title: "Steuerberatung · Haben" }] }),
  component: SteuerberatungPage,
});

type Data = Awaited<ReturnType<typeof getSteuerberatungStart>>;

function SteuerberatungPage() {
  const { aenderungen, years } = Route.useLoaderData();
  const { user, oidc } = Route.useRouteContext();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Zugang für die Steuerberatung · nur lesen</div>
          <h1>Steuerberatung</h1>
        </div>
      </div>
      {user.role === "inhaber" && (
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          So sieht deine Steuerberatung Haben. Zugänge verwaltest du unter{" "}
          <Link to="/einstellungen" search={{ bereich: oidc.only ? "zugaenge" : "sicherheit" }}>
            Einstellungen › {oidc.only ? "Zugänge" : "Sicherheit"}
          </Link>
          .
        </p>
      )}
      <Aenderungen data={aenderungen} />
      <Exporte years={years} />
      {!oidc.only && <PasskeysCard />}
    </>
  );
}

/** Wie der Beleg-Alert in Lexware Office: was seit dem vorigen Besuch dazugekommen ist */
function Aenderungen({ data }: { data: Data["aenderungen"] }) {
  if (!data.since) {
    return (
      <section className="card" aria-labelledby="aenderungen-heading">
        <h2 id="aenderungen-heading">Seit deinem letzten Besuch</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Erster Besuch. Ab der nächsten Anmeldung steht hier, was sich seitdem geändert hat.
        </p>
      </section>
    );
  }
  const rows = [
    { n: data.neueBelege, text: "neue Belege", to: "/belege" as const },
    { n: data.gebuchteBelege, text: "Belege gebucht", to: "/belege" as const },
    { n: data.rechnungen, text: "Rechnungen festgeschrieben", to: "/rechnungen" as const },
    { n: data.buchungen, text: "Buchungen im Journal", to: "/buchungen" as const },
  ];
  const nothing = rows.every((row) => row.n === 0);
  return (
    <section className="card" aria-labelledby="aenderungen-heading">
      <h2 id="aenderungen-heading">Seit deinem letzten Besuch</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Letzter Besuch {formatDateTime(data.since)}.
      </p>
      {data.rueckwirkend > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            {data.rueckwirkend === 1 ? "Eine Buchung trägt" : `${data.rueckwirkend} Buchungen tragen`} ein Datum vor deinem letzten Besuch und ändern damit
            einen Zeitraum, den du vielleicht schon angesehen hast.
          </span>
        </div>
      )}
      {nothing ? (
        <p className="small muted" style={{ margin: 0 }}>
          Seitdem hat sich nichts geändert.
        </p>
      ) : (
        <ul className="stack" style={{ gap: 12, margin: 0, paddingLeft: 20 }}>
          {rows
            .filter((row) => row.n > 0)
            .map((row) => (
              <li key={row.text}>
                <Link to={row.to}>
                  {row.n} {row.text}
                </Link>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function Exporte({ years }: { years: number[] }) {
  const [year, setYear] = useState(() => currentYear());
  const { notice, run } = useAction();
  // Über fetch, damit eine Ablehnung (etwa neue Personenkonten, die nur der Inhaber festschreibt) hier lesbar erscheint (#452)
  function onDatev(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    void run(() => downloadFrom(`/api/datev/${year}`, `EXTF_Buchungsstapel_${year}.csv`));
  }
  return (
    <section className="card" aria-labelledby="exporte-heading">
      <h2 id="exporte-heading">Exporte</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Das Jahresarchiv enthält alle Rechnungen, Belege, Buchungen, Bankumsätze und Voranmeldungen eines Jahres mit den Originaldateien, CSV-Tabellen und
        Prüfsummen. Der DATEV-Buchungsstapel braucht Berater- und Mandantennummer, die der Inhaber in den Einstellungen hinterlegt.
      </p>
      <label className="field" style={{ maxWidth: 200 }}>
        Jahr
        <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <a className="btn" href={`/api/export/${year}`} download>
          Jahresarchiv (ZIP)
        </a>
        <a className="btn" href={`/api/datev/${year}`} download onClick={onDatev}>
          DATEV-Buchungsstapel
        </a>
        <a className="btn" href={`/api/konten/${year}`} download>
          Saldenliste (CSV)
        </a>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}
