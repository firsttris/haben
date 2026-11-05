import { datumText } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { z } from "zod";
import { Formular } from "../../components/sv-meldeportal/Formular.tsx";
import { Vermerk } from "../../components/sv-meldeportal/Vermerk.tsx";
import { getSvMeldeportal } from "../../server/functions/sv-meldungen.ts";
import styles from "../../styles/auswertungen.css?url";

/*
 * Personal › SV-Meldeportal: Ausfüllliste je Monat (docs/lohn-plan.md, PR 6). Beitragsnachweise je Einzugsstelle und
 * DEÜV-Meldungen je Person, Feld für Feld wie im SV-Meldeportal, dazu der Vermerk „im Portal abgegeben“. Haben
 * übermittelt nichts an die Sozialversicherung; das Portal verbietet automatisches Befüllen.
 */

export const Route = createFileRoute("/_app/sv-meldeportal")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional(), monat: z.number().int().min(1).max(12).optional() }),
  loaderDeps: ({ search }) => ({ jahr: search.jahr ?? new Date().getFullYear(), monat: search.monat ?? new Date().getMonth() + 1 }),
  loader: ({ deps }) => getSvMeldeportal({ data: { year: deps.jahr, month: deps.monat } }),
  head: () => ({ meta: [{ title: "SV-Meldeportal · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: SvMeldeportalPage,
});

type Data = Awaited<ReturnType<typeof getSvMeldeportal>>;
type Nachweis = Data["beitragsnachweise"][number];
type Meldung = Data["meldungen"][number];

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function MonatWahl({ data }: { data: Data }) {
  const navigate = useNavigate();
  const monatId = useId();
  const jahrId = useId();
  const dieses = Number(data.heute.slice(0, 4));
  const jahre = [...new Set([data.jahr, dieses + 1, dieses, dieses - 1])].sort((a, b) => b - a);
  const gehe = (jahr: number, monat: number) => navigate({ to: "/sv-meldeportal", search: { jahr, monat } });
  return (
    <div className="actions">
      <label className="field" htmlFor={monatId}>
        Monat
        <select id={monatId} value={data.monat} onChange={(e) => gehe(data.jahr, Number(e.target.value))}>
          {MONATE.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={jahrId}>
        Jahr
        <select id={jahrId} value={data.jahr} onChange={(e) => gehe(Number(e.target.value), data.monat)}>
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

function Hinweise({ hinweise }: { hinweise: string[] }) {
  if (hinweise.length === 0) return null;
  return (
    <div className="banner banner-info" role="note">
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {hinweise.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </div>
  );
}

function Status({ abgegeben, geaendert }: { abgegeben: boolean; geaendert: boolean }) {
  if (geaendert) return <span className="pill pill-danger">geändert seit Abgabe</span>;
  return abgegeben ? <span className="pill pill-ok">abgegeben</span> : <span className="pill pill-warn">offen</span>;
}

function NachweisKarte({ b, heute }: { b: Nachweis; heute: string }) {
  const headingId = useId();
  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h3 id={headingId} style={{ margin: 0 }}>
          {b.titel}
        </h3>
        <Status abgegeben={b.stand.abgegeben} geaendert={b.stand.geaendert} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Im Portal: {b.formular}. Übermitteln bis {datumText(b.termine.nachweisBis)} (liegt am {datumText(b.termine.nachweisVorliegen)} um 0 Uhr vor), Beiträge
        fällig am {datumText(b.termine.faelligkeit)}.{b.personen.length > 0 ? ` Enthalten: ${b.personen.join(", ")}.` : ""}
      </p>
      <Hinweise hinweise={b.hinweise} />
      <Formular abschnitte={b.abschnitte} />
      <Vermerk gegenstand={b.gegenstand} titel={b.titel} stand={b.stand} heute={heute} />
    </section>
  );
}

function MeldungKarte({ m, heute }: { m: Meldung; heute: string }) {
  const headingId = useId();
  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h3 id={headingId} style={{ margin: 0 }}>
          {m.titel}
        </h3>
        <Status abgegeben={m.stand.abgegeben} geaendert={m.stand.geaendert} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Im Portal: {m.formular}.{m.frist ? ` Frist: ${datumText(m.frist)}.` : ""}
        {!m.vollstaendig && " Es fehlen Pflichtangaben; erst in den Stammdaten ergänzen."}
      </p>
      <Hinweise hinweise={m.hinweise} />
      <Formular abschnitte={m.abschnitte} />
      <Vermerk gegenstand={m.gegenstand} titel={m.titel} stand={m.stand} heute={heute} />
    </section>
  );
}

function OffenAnderswo({ data }: { data: Data }) {
  if (data.offenAnderswo.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="offen-heading">
      <h2 id="offen-heading" style={{ margin: 0 }}>
        Offene Meldungen aus anderen Monaten
      </h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {data.offenAnderswo.map((o) => (
          <li key={o.gegenstand}>
            <Link to="/sv-meldeportal" search={{ jahr: o.jahr, monat: o.monat }}>
              {o.titel}
            </Link>{" "}
            <span className="small muted">Frist {datumText(o.frist)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SvMeldeportalPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Personal</div>
          <h1>SV-Meldeportal {data.name}</h1>
        </div>
        <MonatWahl data={data} />
      </div>
      <div className="stack" style={{ gap: 24 }}>
        <div className="banner banner-danger" role="note">
          <strong>Haben übermittelt nicht an die Sozialversicherung.</strong> Beitragsnachweise und Meldungen gibst du selbst im{" "}
          <a href="https://info.sv-meldeportal.de/" target="_blank" rel="noreferrer">
            SV-Meldeportal
          </a>{" "}
          ab, Minijobs an die Minijob-Zentrale ebenfalls dort. Das Portal kennt keinen Import und verbietet automatisches Befüllen; deshalb steht hier jedes
          Feld zum Abtippen, in der Reihenfolge des Formulars. Danach vermerkst du die Abgabe mit Datum und hängst das Protokoll an.
        </div>
        <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
          Tipp: Mit aktiviertem Online-Speicher legst du Firma und Mitarbeiter einmal im Portal an; der Stammdaten-Assistent füllt dann Name, Anschrift und
          Versicherungsnummer, und du tippst je Monat nur noch die Beträge. Die Betriebsnummer deiner Firma nimmt das Portal aus deinen Firmen-Basisdaten.
          Grundlage sind die festgeschriebenen Abrechnungen unter <Link to="/lohn">Lohn</Link>.
        </p>
        {data.ohneSv.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Ohne Meldungen und Beitragsnachweis: {data.ohneSv.join(", ")} (Gesellschafter-Geschäftsführer ohne Sozialversicherungspflicht).
          </p>
        )}
        <OffenAnderswo data={data} />
        <section className="stack" aria-labelledby="nachweis-heading">
          <h2 id="nachweis-heading" style={{ margin: 0 }}>
            Beitragsnachweise {data.name}
          </h2>
          {data.beitragsnachweise.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              In diesem Monat ist niemand mit Sozialversicherung beschäftigt; es gibt keinen Beitragsnachweis.
            </p>
          ) : (
            data.beitragsnachweise.map((b) => <NachweisKarte key={b.gegenstand} b={b} heute={data.heute} />)
          )}
        </section>
        <section className="stack" aria-labelledby="meldungen-heading">
          <h2 id="meldungen-heading" style={{ margin: 0 }}>
            Meldungen {data.name}
          </h2>
          {data.meldungen.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Keine An-, Ab- oder Jahresmeldung mit Anlass in diesem Monat.
            </p>
          ) : (
            data.meldungen.map((m) => <MeldungKarte key={m.gegenstand} m={m} heute={data.heute} />)
          )}
        </section>
      </div>
    </>
  );
}
