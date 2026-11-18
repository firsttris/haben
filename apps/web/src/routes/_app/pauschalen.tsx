import { currentYear, formatEuro, type PauschaleArt, isKapitalgesellschaft } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod/mini";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import type { Notice } from "../../lib/use-action.ts";
import { getPauschalen } from "../../server/functions/pauschalen.ts";
import styles from "../../styles/auswertungen.css?url";
import { EntfernungTab, FahrtForm, HomeofficeForm, VerpflegungForm } from "./-pauschalen-formulare.tsx";
import { Liste, OnlyEinzelunternehmen } from "./-pauschalen-liste.tsx";

export const Route = createFileRoute("/_app/pauschalen")({
  validateSearch: z.object({ jahr: z.optional(z.int().check(z.minimum(2000), z.maximum(2100))) }),
  loaderDeps: ({ search }) => ({ year: search.jahr ?? currentYear() }),
  loader: ({ deps }) => getPauschalen({ data: deps.year }),
  head: () => ({ meta: [{ title: "Pauschalen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: PauschalenPage,
});

const ARTEN: PauschaleArt[] = ["homeoffice", "fahrt", "verpflegung", "entfernung"];
const ART_KURZ: Record<PauschaleArt, string> = {
  homeoffice: "Homeoffice",
  fahrt: "Fahrt",
  verpflegung: "Verpflegung",
  entfernung: "Wege zur Betriebsstätte",
};
function PauschalenPage() {
  const { rechtsform } = Route.useRouteContext();
  if (isKapitalgesellschaft(rechtsform)) return <OnlyEinzelunternehmen />;
  return <PauschalenList />;
}

function PauschalenList() {
  const data = Route.useLoaderData();
  const { year, totals, homeoffice } = data;
  const [art, setArt] = useState<PauschaleArt>("homeoffice");
  const [notice, setNotice] = useState<Notice>(null);
  const thisYear = currentYear();
  const years = [...new Set([thisYear, thisYear - 1, thisYear - 2, year])].sort((a, b) => b - a);
  const summe = totals.homeoffice + totals.fahrt + totals.verpflegung + totals.entfernung;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgaben ohne Beleg</div>
          <h1>Pauschalen {year}</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Homeoffice-Tage, Fahrten mit dem eigenen Auto, Wege zur Betriebsstätte und Verpflegung auf Geschäftsreisen mindern den Gewinn, ohne dass du etwas
        bezahlt hast, das einen Beleg hätte. Haben bucht sie als Ausgabe an Privateinlage und trägt sie in die richtigen Zeilen der{" "}
        <Link to="/jahreserklaerung">Anlage EÜR</Link> ein. Halte fest, wann du wo warst (Kalender, Fahrtenliste); das Finanzamt kann danach fragen.
      </p>

      <nav className="filter-row" aria-label="Jahr wählen">
        <div className="chip-row">
          {years.map((y) => (
            <Link key={y} to="/pauschalen" search={{ jahr: y }} className={y === year ? "chip active" : "chip"} aria-current={y === year ? "page" : undefined}>
              {y}
            </Link>
          ))}
        </div>
      </nav>

      <div className="grid-5" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Homeoffice</div>
          <div className="kpi-value">{formatEuro(totals.homeoffice)}</div>
          <div className="small muted">{homeoffice.maxTage ? `${homeoffice.tage} von ${homeoffice.maxTage} Tagen` : "erst ab 2020"}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Fahrten</div>
          <div className="kpi-value">{formatEuro(totals.fahrt)}</div>
          <div className="small muted">0,30 € je km mit dem Auto</div>
        </div>
        <div className="card">
          <div className="kpi-label">Verpflegung</div>
          <div className="kpi-value">{formatEuro(totals.verpflegung)}</div>
          <div className="small muted">Mehraufwand auf Reisen</div>
        </div>
        <div className="card">
          <div className="kpi-label">Wege zur Betriebsstätte</div>
          <div className="kpi-value">{formatEuro(totals.entfernung)}</div>
          <div className="small muted">Entfernungspauschale</div>
        </div>
        <div className="card">
          <div className="kpi-label">Zusammen {year}</div>
          <div className="kpi-value">{formatEuro(summe)}</div>
          <div className="small muted">weniger Gewinn laut EÜR</div>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <section className="card" aria-labelledby="neu-heading">
          <h2 id="neu-heading" style={{ margin: 0, fontSize: 16 }}>
            Pauschale eintragen
          </h2>
          <div className="mode-switch" role="group" aria-label="Art der Pauschale">
            {ARTEN.map((a) => (
              <button
                key={a}
                type="button"
                className={`chip${art === a ? " active" : ""}`}
                aria-pressed={art === a}
                onClick={() => {
                  setArt(a);
                  setNotice(null);
                }}
              >
                {ART_KURZ[a]}
              </button>
            ))}
          </div>
          {/* key: Ein anderes Jahr setzt die Formulare neu auf, samt Vorgabedatum und Grenzen des Jahres */}
          {art === "homeoffice" && <HomeofficeForm key={year} data={data} onNotice={setNotice} />}
          {art === "fahrt" && <FahrtForm key={year} data={data} onNotice={setNotice} />}
          {art === "verpflegung" && <VerpflegungForm key={year} data={data} onNotice={setNotice} />}
          {art === "entfernung" && <EntfernungTab key={year} data={data} onNotice={setNotice} />}
          <NoticeBanner notice={notice} />
        </section>

        <Liste data={data} />
      </div>
    </>
  );
}
