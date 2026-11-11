import { formatEuro, KONFESSIONEN, type LstbWerte } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ELSTER_KIND_LABEL, elsterNotice, type ElsterKind } from "../../../lib/elster.ts";
import { formatDate, formatLongDate } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getLstb, stornoLstbFn, submitLstbFn, vermerkeLstbFn } from "../../../server/functions/lstb.ts";
import { Field } from "../../../components/Field.tsx";

/*
 * Personal › Lohnsteuerbescheinigung (§ 41b EStG): je Mitarbeiter und Jahr die Werte aus den festgeschriebenen
 * Abrechnungen, der Ausdruck für den Arbeitnehmer, Übermitteln über ERiC (bis 2025) oder der Vermerk einer Übermittlung
 * im ELSTER-Portal, Korrektur und Storno, und der Verlauf.
 */

export const Route = createFileRoute("/_app/lohn/bescheinigung/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getLstb({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Lohnsteuerbescheinigungen ${loaderData?.year ?? ""} · Haben` }] }),
  component: LstbPage,
});

type Data = Awaited<ReturnType<typeof getLstb>>;
type Mitarbeiter = Data["mitarbeiter"][number];

const STATUS: Record<Mitarbeiter["status"], string> = {
  bereit: "bereit zur Übermittlung",
  uebermittelt: "übermittelt",
  abweichend: "übermittelt, die Abrechnungen ergeben inzwischen andere Werte: Korrektur nötig",
  storniert: "storniert",
  keine: "keine Bescheinigung",
  offen: "noch nicht fertig",
  "nicht-unterstuetzt": "nicht unterstützt",
};

const ART: Record<"neu" | "korrektur" | "storno", string> = { neu: "Bescheinigung", korrektur: "Korrektur", storno: "Stornierung" };

const zahl = (tausendstel: number) => (tausendstel / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 });

function LstbPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const dieses = Number(data.heute.slice(0, 4));
  const jahre = [...new Set([data.year, dieses, dieses - 1])].sort((a, b) => b - a);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Personal › Lohnsteuerbescheinigung</div>
          <h1>Lohnsteuerbescheinigungen {data.year}</h1>
        </div>
        <Field label="Jahr">
          {(control) => (
            <select {...control} value={data.year} onChange={(e) => navigate({ to: "/lohn/bescheinigung/$jahr", params: { jahr: e.target.value } })}>
              {jahre.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="stack" style={{ gap: 24 }}>
        <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
          Nach dem Abschluss des Lohnkontos, am Jahresende oder mit dem Austritt, übermittelt der Arbeitgeber je Arbeitnehmer die elektronische
          Lohnsteuerbescheinigung, für {data.year} bis zum {formatLongDate(data.frist)} (§ 41b EStG, § 93c AO), und gibt ihm einen Ausdruck. Haben nimmt die
          Werte aus den festgeschriebenen Abrechnungen; Minijobs mit Pauschsteuer bekommen keine Bescheinigung. <Link to="/lohn">Zur Lohnabrechnung</Link>
        </p>
        {data.ohneSchnittstelle && (
          <div className="banner banner-info" role="note">
            <Icon name="info" />
            <span>
              {data.ohneSchnittstelle} Übermittle die Bescheinigung in Mein ELSTER mit dem Formular „Lohnsteuerbescheinigung (Neu / Korrektur) ab 2026“ und den
              Werten unten, dann vermerke hier Tag und Transferticket.
            </span>
          </div>
        )}
        {data.firmenfehler.length > 0 && (
          <div className="banner banner-danger" role="note">
            <Icon name="alert" />
            <span>
              Firmendaten: {data.firmenfehler.join(", ")}. <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
            </span>
          </div>
        )}
        {data.mitarbeiter.length === 0 ? (
          <section className="card">
            <p style={{ margin: 0 }}>Für {data.year} gibt es keine Abrechnung.</p>
          </section>
        ) : (
          data.mitarbeiter.map((m) => <MitarbeiterKarte key={m.id} data={data} m={m} />)
        )}
      </div>
    </>
  );
}

function MitarbeiterKarte({ data, m }: { data: Data; m: Mitarbeiter }) {
  const headingId = useId();
  const werte = m.ergebnis.status === "bereit" ? m.ergebnis.werte : (m.aktuell?.werte ?? null);
  const offen = !m.aktuell || m.aktuell.art === "storno";
  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id={headingId} style={{ margin: 0 }}>
          {m.name}
        </h2>
        <span className="small muted">
          Nr. {m.personalnummer} · {STATUS[m.status]}
        </span>
      </div>
      {m.ergebnis.status !== "bereit" && (
        <div className={`banner ${m.ergebnis.status === "nicht-unterstuetzt" ? "banner-danger" : "banner-info"}`} role="note">
          {m.ergebnis.meldung}
        </div>
      )}
      {werte && <Werte werte={werte} name={m.name} />}
      {m.ausdruck && (m.ausdruck === "uebermittelt" || data.firmenfehler.length === 0) && (
        <p style={{ margin: 0 }}>
          <a href={`/api/lohn/bescheinigung/${m.id}/${data.year}`}>
            {m.ausdruck === "entwurf" ? "Entwurf des Ausdrucks (PDF)" : "Ausdruck für den Arbeitnehmer (PDF)"}
          </a>
        </p>
      )}
      {!data.ohneSchnittstelle && m.naechste && <EricSenden data={data} m={m} />}
      {!data.ohneSchnittstelle && !offen && m.aktuell?.kind !== "portal" && <EricStorno data={data} m={m} />}
      {(m.naechste || (offen && m.ergebnis.status === "nicht-unterstuetzt")) && (
        <Vermerk data={data} m={m} art={m.naechste === "korrektur" ? "korrektur" : "neu"} />
      )}
      {!offen && <Vermerk data={data} m={m} art="storno" />}
      {m.verlauf.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 4px" }}>Verlauf</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {m.verlauf.map((s) => (
              <li key={s.id}>
                {ART[s.art]} · {s.kind === "portal" ? "im ELSTER-Portal übermittelt" : ELSTER_KIND_LABEL[s.kind]} · {formatDate(s.datum)}
                {s.kind !== "portal" ? (s.ok ? " · OK" : ` · Fehler ${s.code}: ${s.message}`) : ""}
                {s.transferTicket ? ` · Transferticket ${s.transferTicket}` : ""}
                {s.grund ? ` · Grund: ${s.grund}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Die Werte wie im Ausdruck: zugleich die Ausfüllliste für Mein ELSTER */
function Werte({ werte: w, name }: { werte: LstbWerte; name: string }) {
  const zeilen: [string, string][] = [
    ["1. Bescheinigungszeitraum", `${formatDate(w.von)} – ${formatDate(w.bis)}`],
    ["3. Bruttoarbeitslohn", formatEuro(w.bruttoarbeitslohn)],
    ["4. Lohnsteuer", formatEuro(w.lohnsteuer)],
    ["5. Solidaritätszuschlag", formatEuro(w.soli)],
    ["6. Kirchensteuer des Arbeitnehmers", formatEuro(w.kirchensteuer)],
    ["22. a) Arbeitgeberanteil Rentenversicherung", formatEuro(w.rvArbeitgeber)],
    ["23. a) Arbeitnehmeranteil Rentenversicherung", formatEuro(w.rvArbeitnehmer)],
    ["25. Krankenversicherung (Arbeitnehmer)", formatEuro(w.kvArbeitnehmer)],
    ["26. Pflegeversicherung (Arbeitnehmer)", formatEuro(w.pvArbeitnehmer)],
    ["27. Arbeitslosenversicherung (Arbeitnehmer)", formatEuro(w.avArbeitnehmer)],
    ...(w.pkvBasis
      ? ([
          w.jahr >= 2026
            ? ["Private Basiskranken- und Pflege-Pflichtversicherung im Monat", formatEuro(w.pkvBasis.letzterMonat)]
            : ["28. Private Kranken- und Pflege-Pflichtversicherung", formatEuro(w.pkvBasis.jahr)],
        ] as [string, string][])
      : []),
    ...w.merkmale.map((x): [string, string] => [
      `Merkmale ab ${formatDate(x.gueltigAb)}`,
      `Steuerklasse ${x.steuerklasse}${x.faktor !== 1000 ? ` mit Faktor ${zahl(x.faktor)}` : ""}, Kinderfreibeträge ${zahl(x.kinderfreibetraege)}, ${x.konfession ? KONFESSIONEN[x.konfession] : "keine Kirchensteuer"}`,
    ]),
  ];
  return (
    <table>
      <caption className="visually-hidden">
        Lohnsteuerbescheinigung {w.jahr} von {name}
      </caption>
      <tbody>
        {zeilen.map(([label, wert]) => (
          <tr key={label}>
            <th scope="row" style={{ fontWeight: 400 }}>
              {label}
            </th>
            <td className="num">{wert}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function bescheinigungFakten(year: number, name: string) {
  return [
    { label: "Meldung", value: "Lohnsteuerbescheinigung" },
    { label: "Zeitraum", value: String(year) },
    { label: "Person", value: name },
  ];
}

function EricSenden({ data, m }: { data: Data; m: Mitarbeiter }) {
  const router = useRouter();
  const submit = useServerFn(submitLstbFn);
  const action = useAction();
  const korrektur = m.naechste === "korrektur";
  const onSubmit = (kind: ElsterKind, pin?: string) =>
    action.run(async () => {
      const result = await submit({ data: { employeeId: m.id, year: data.year, kind, pin } });
      await router.invalidate();
      action.setNotice(elsterNotice(kind, result, korrektur ? "Korrektur übermittelt." : "Lohnsteuerbescheinigung übermittelt."));
    });
  return (
    <ElsterSubmit
      setup={data}
      className="stack"
      title={korrektur ? `Korrektur für ${m.name} senden` : `Bescheinigung für ${m.name} senden`}
      ready={data.firmenfehler.length === 0}
      busy={action.busy}
      notice={action.notice}
      confirmTitle={`${korrektur ? "Korrektur der " : ""}Lohnsteuerbescheinigung ${data.year} für ${m.name} verbindlich senden?`}
      confirmFacts={bescheinigungFakten(data.year, m.name)}
      confirmText={`Die ${korrektur ? "Korrektur der " : ""}Lohnsteuerbescheinigung ${data.year} von ${m.name} geht verbindlich an die Finanzverwaltung.`}
      footer="Datenart LStB im Verfahren ElsterLohn über ERiC. ERiC prüft dabei nur den Umschlag; Fehler in den Daten meldet die Finanzverwaltung im Verarbeitungsprotokoll. Die PIN wird nicht gespeichert."
      onSubmit={onSubmit}
    />
  );
}

function EricStorno({ data, m }: { data: Data; m: Mitarbeiter }) {
  const router = useRouter();
  const storno = useServerFn(stornoLstbFn);
  const action = useAction();
  const onSubmit = (kind: ElsterKind, pin?: string) =>
    action.run(async () => {
      const result = await storno({ data: { employeeId: m.id, year: data.year, kind, pin, grund: "" } });
      await router.invalidate();
      action.setNotice(elsterNotice(kind, result, "Stornierung übermittelt."));
    });
  return (
    <ElsterSubmit
      setup={data}
      className="stack"
      title={`Bescheinigung von ${m.name} stornieren`}
      ready
      busy={action.busy}
      notice={action.notice}
      confirmTitle={`Lohnsteuerbescheinigung ${data.year} von ${m.name} stornieren?`}
      confirmFacts={bescheinigungFakten(data.year, m.name)}
      confirmText={`Die Lohnsteuerbescheinigung ${data.year} von ${m.name} wird bei der Finanzverwaltung storniert.`}
      confirmLabel="Storno senden"
      confirmDanger
      footer="Nur, wenn die Bescheinigung nicht hätte übermittelt werden dürfen, etwa für den falschen Arbeitnehmer; falsche Werte korrigierst du mit einer Korrektur (§ 93c Abs. 3 AO)."
      onSubmit={onSubmit}
    />
  );
}

/** Vermerk einer im ELSTER-Portal übermittelten Bescheinigung, Korrektur oder Stornierung */
function Vermerk({ data, m, art }: { data: Data; m: Mitarbeiter; art: "neu" | "korrektur" | "storno" }) {
  const router = useRouter();
  const vermerke = useServerFn(vermerkeLstbFn);
  const action = useAction();
  const [datum, setDatum] = useState(data.heute);
  const [ticket, setTicket] = useState("");
  const [grund, setGrund] = useState("");
  const titel = `${ART[art]} im ELSTER-Portal vermerken`;
  function absenden(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      await vermerke({ data: { employeeId: m.id, year: data.year, art, datum, transferTicket: ticket, grund } });
      await router.invalidate();
      setTicket("");
      action.setNotice({ tone: "ok", text: `${ART[art]} vermerkt.` });
    });
  }
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={absenden} aria-label={`${titel}: ${m.name}`}>
      <h3 style={{ margin: 0 }}>{titel}</h3>
      <p className="small muted" style={{ margin: 0 }}>
        {art === "storno"
          ? "Nur, wenn die Bescheinigung nicht hätte übermittelt werden dürfen; falsche Werte korrigierst du mit einer Korrektur (§ 93c Abs. 3 AO)."
          : `Nach dem Absenden in Mein ELSTER: Tag und Transferticket aus der Bestätigung. Haben hält die Werte ${art === "korrektur" ? "der Korrektur " : ""}fest, die es gerade rechnet.`}
      </p>
      <div className="actions" style={{ alignItems: "end" }}>
        <Field label="Übermittelt am">
          {(control) => <input {...control} type="date" value={datum} max={data.heute} onChange={(e) => setDatum(e.target.value)} required />}
        </Field>
        <Field label="Transferticket">
          {(control) => <input {...control} value={ticket} onChange={(e) => setTicket(e.target.value)} required maxLength={100} />}
        </Field>
        {art === "storno" && (
          <Field label="Grund">{(control) => <input {...control} value={grund} onChange={(e) => setGrund(e.target.value)} maxLength={500} />}</Field>
        )}
        <button type="submit" className="btn" disabled={action.busy}>
          {art === "storno" ? "Stornierung vermerken" : "Übermittlung vermerken"}
        </button>
      </div>
      <NoticeBanner notice={action.notice} />
    </form>
  );
}
