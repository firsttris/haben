import { BESCHAEFTIGUNGSARTEN, formatEuro, monatsgrenzen } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { z } from "zod";
import { AbrechnungKarte } from "../../../components/lohn/AbrechnungKarte.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { formatDate } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { abrechnenFn, getLohn } from "../../../server/functions/lohn.ts";
import styles from "../../../styles/auswertungen.css?url";

/*
 * Personal › Lohn: Mitarbeiter und die Abrechnung eines Monats. Haben rechnet Lohnsteuer und Sozialversicherung, hält
 * die Abrechnung fest und gibt Entgeltabrechnung und Lohnkonto aus; Buchung, Lohnsteuer-Anmeldung und Meldungen an die
 * Sozialversicherung kommen später (docs/lohn-plan.md).
 */

export const Route = createFileRoute("/_app/lohn/")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional(), monat: z.number().int().min(1).max(12).optional() }),
  loaderDeps: ({ search }) => ({ jahr: search.jahr ?? new Date().getFullYear(), monat: search.monat ?? new Date().getMonth() + 1 }),
  loader: ({ deps }) => getLohn({ data: { year: deps.jahr, month: deps.monat } }),
  head: () => ({ meta: [{ title: "Lohn · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: LohnPage,
});

type Data = Awaited<ReturnType<typeof getLohn>>;
type Zeile = Data["monat"]["zeilen"][number];

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function MonatWahl({ data }: { data: Data }) {
  const navigate = useNavigate();
  const monatId = useId();
  const jahrId = useId();
  const dieses = new Date().getFullYear();
  const jahre = [...new Set([data.monat.year, dieses, dieses - 1])].sort((a, b) => b - a);
  const gehe = (jahr: number, monat: number) => navigate({ to: "/lohn", search: { jahr, monat } });
  return (
    <div className="actions">
      <label className="field" htmlFor={monatId}>
        Monat
        <select id={monatId} value={data.monat.month} onChange={(e) => gehe(data.monat.year, Number(e.target.value))}>
          {MONATE.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={jahrId}>
        Jahr
        <select id={jahrId} value={data.monat.year} onChange={(e) => gehe(Number(e.target.value), data.monat.month)}>
          {jahre.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Abrechnen({ data }: { data: Data }) {
  const router = useRouter();
  const abrechnen = useServerFn(abrechnenFn);
  const { busy, notice, setNotice, run } = useAction();
  const { year, month } = data.monat;
  const [zahltag, setZahltag] = useState(data.monat.zahltag ?? monatsgrenzen(year, month).letzter);
  const zahltagId = useId();
  const offen = data.monat.zeilen.filter((z) => !z.payslips.some((p) => !p.storno)).length;

  function absenden(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const r = await abrechnen({ data: { year, month, zahltag } });
      await router.invalidate();
      const fehler = r.fehler.map((f) => `${f.name}: ${f.meldung}`).join(" ");
      setNotice(
        r.fehler.length > 0
          ? { tone: "danger", text: `${r.angelegt} Entwürfe angelegt. Nicht abgerechnet: ${fehler}` }
          : { tone: "ok", text: r.angelegt === 1 ? "Ein Entwurf angelegt." : `${r.angelegt} Entwürfe angelegt.` },
      );
    });
  }

  return (
    <section className="card stack" aria-labelledby="abrechnen-heading">
      <h2 id="abrechnen-heading" style={{ margin: 0 }}>
        {data.monat.name} abrechnen
      </h2>
      <form className="actions" style={{ alignItems: "end" }} onSubmit={absenden} aria-label={`${data.monat.name} abrechnen`}>
        <label className="field" htmlFor={zahltagId}>
          Zahltag
          <input id={zahltagId} type="date" value={zahltag} onChange={(e) => setZahltag(e.target.value)} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || data.employees.length === 0}>
          Monat abrechnen
        </button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>
        {offen > 0 ? `${offen} von ${data.monat.zeilen.length} ohne Abrechnung. ` : ""}
        Legt für jeden Mitarbeiter ohne Abrechnung in diesem Monat einen Entwurf an. Prüfe ihn, sieh dir das PDF an und schreib ihn fest.
      </p>
      {!data.monat.bundesland && (
        <div className="banner banner-danger" role="note">
          In den <Link to="/einstellungen">Firmendaten</Link> fehlt das Bundesland; davon hängen Kirchensteuer und Pflegeversicherung ab.
        </div>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}

function MitarbeiterMonat({ zeile }: { zeile: Zeile }) {
  const headingId = useId();
  const { employee, payslips, vorschau } = zeile;
  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id={headingId} style={{ margin: 0 }}>
          {employee.name}
        </h2>
        <span className="small muted">
          Nr. {employee.personalnummer} · {BESCHAEFTIGUNGSARTEN[employee.art]}
        </span>
      </div>
      {vorschau && !vorschau.ok && (
        <div className="banner banner-danger" role="note">
          Nicht abrechenbar (
          {vorschau.grund === "nicht-unterstuetzt" ? "nicht unterstützt" : vorschau.grund === "nicht-hinterlegt" ? "nicht hinterlegt" : "ungültig"}):{" "}
          {vorschau.meldung}
        </div>
      )}
      {vorschau?.ok && (
        <p className="small muted" style={{ margin: 0 }}>
          Noch nicht abgerechnet; voraussichtlich {formatEuro(vorschau.brutto)} brutto, {formatEuro(vorschau.netto)} netto.
        </p>
      )}
      {[...payslips].reverse().map((p) => (
        <AbrechnungKarte key={p.id} p={p} />
      ))}
    </section>
  );
}

function MitarbeiterListe({ data }: { data: Data }) {
  const jahr = data.monat.year;
  return (
    <section className="card stack" aria-labelledby="mitarbeiter-heading">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h2 id="mitarbeiter-heading" style={{ margin: 0 }}>
          Mitarbeiter
        </h2>
        <Link to="/lohn/mitarbeiter/neu" className="btn">
          Mitarbeiter anlegen
        </Link>
      </div>
      {data.employees.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch keine Mitarbeiter. Haben rechnet Gesellschafter-Geschäftsführer ohne Sozialversicherung, Minijobs mit Pauschsteuer und, als Entwurf zum
          Gegenprüfen, versicherungspflichtig Beschäftigte mit festem Monatsgehalt.
        </p>
      ) : (
        <table className="report-table stack-table">
          <thead>
            <tr>
              <th scope="col">Nr.</th>
              <th scope="col">Name</th>
              <th scope="col">Beschäftigung</th>
              <th scope="col" className="num">
                Monatsgehalt
              </th>
              <th scope="col">Zeitraum</th>
              <th scope="col">Lohnkonto {jahr}</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => (
              <tr key={e.id}>
                <td data-label="Nr.">{e.personalnummer}</td>
                <th scope="row" data-label="Name">
                  <Link to="/lohn/mitarbeiter/$id" params={{ id: e.id }}>
                    {e.name}
                  </Link>
                </th>
                <td data-label="Beschäftigung">{BESCHAEFTIGUNGSARTEN[e.art]}</td>
                <td className="num" data-label="Monatsgehalt">
                  {formatEuro(e.monatsgehalt)}
                </td>
                <td data-label="Zeitraum">{e.austritt ? `${formatDate(e.eintritt)} – ${formatDate(e.austritt)}` : `seit ${formatDate(e.eintritt)}`}</td>
                <td data-label={`Lohnkonto ${jahr}`}>
                  <a href={`/api/lohn/lohnkonto/${e.id}/${jahr}/pdf`} aria-label={`Lohnkonto ${jahr} von ${e.name} als PDF`}>
                    PDF
                  </a>{" "}
                  ·{" "}
                  <a href={`/api/lohn/lohnkonto/${e.id}/${jahr}/csv`} aria-label={`Lohnkonto ${jahr} von ${e.name} als CSV`}>
                    CSV
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function LohnPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Personal</div>
          <h1>Lohn {data.monat.name}</h1>
        </div>
        <MonatWahl data={data} />
      </div>
      <div className="stack" style={{ gap: 24 }}>
        <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
          Haben rechnet Lohnsteuer, Solidaritätszuschlag, Kirchensteuer und Sozialversicherung, hält die Abrechnung fest und gibt Entgeltabrechnung und
          Lohnkonto aus. Gebucht wird der Lohn noch nicht; Lohnsteuer-Anmeldung und Meldungen an die Sozialversicherung übermittelt Haben nicht.
        </p>
        <Abrechnen data={data} />
        {data.monat.zeilen.map((z) => (
          <MitarbeiterMonat key={z.employee.id} zeile={z} />
        ))}
        <MitarbeiterListe data={data} />
      </div>
    </>
  );
}
