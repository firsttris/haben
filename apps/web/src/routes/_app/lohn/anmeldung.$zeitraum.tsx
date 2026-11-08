import {
  BESCHAEFTIGUNGSARTEN,
  formatEuro,
  LSTA_TURNUS_LABEL,
  lstaLabel,
  monatsname,
  parseLstaKey,
  summeJahresteile,
  type Jahresteile,
  type LstaKennzahlen,
  type LstaTurnus,
} from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ELSTER_KIND_LABEL, elsterNotice, type ElsterKind } from "../../../lib/elster.ts";
import { formatDate, formatDateTime, formatLongDate } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getLsta, saveLstaTurnusFn, submitLstaFn } from "../../../server/functions/lsta.ts";

export const Route = createFileRoute("/_app/lohn/anmeldung/$zeitraum")({
  loader: ({ params }) => {
    const zeitraum = parseLstaKey(params.zeitraum);
    if (!zeitraum) throw notFound();
    return getLsta({ data: zeitraum });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Lohnsteuer-Anmeldung ${loaderData?.label ?? ""} · Haben` }] }),
  component: LstaPage,
});

type Data = Awaited<ReturnType<typeof getLsta>>;

/** Lohnsteuer-Anmeldung eines Zeitraums (§ 41a EStG): Kennzahlen aus den festgeschriebenen Abrechnungen, Senden, Verlauf */
function LstaPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const selectId = useId();
  const options = data.zeitraeume.some((z) => z.key === data.key) ? data.zeitraeume : [...data.zeitraeume, { ...data.zeitraum, key: data.key }];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Personal › Lohnsteuer-Anmeldung</div>
          <h1>{data.label}</h1>
        </div>
        <label className="field" htmlFor={selectId}>
          Zeitraum
          <select id={selectId} value={data.key} onChange={(event) => navigate({ to: "/lohn/anmeldung/$zeitraum", params: { zeitraum: event.target.value } })}>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {lstaLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.</span>
        </div>
      )}
      {data.issues.map((issue) => (
        <div key={issue.text} className={`banner ${issue.tone === "info" ? "banner-info" : ""}`} role="status">
          <Icon name={issue.tone === "info" ? "info" : "alert"} />
          <span>
            {issue.text}
            {issue.tone === "error" && issue.text.startsWith("Firmendaten") && (
              <>
                {" "}
                <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
              </>
            )}
          </span>
        </div>
      ))}

      <div className="grid-main">
        <div className="stack">
          <section className="card" aria-labelledby="lsta-kennzahlen-heading">
            <h2 id="lsta-kennzahlen-heading">Kennzahlen</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Aus den festgeschriebenen Abrechnungen mit Zahltag im Zeitraum. Abgabe und Zahlung bis {formatLongDate(data.frist)} (§ 41a Abs. 1 EStG). Die
              Pauschsteuer im Minijob geht an die Minijob-Zentrale, nicht in diese Anmeldung.
            </p>
            {data.kennzahlen ? (
              <KennzahlenTable kennzahlen={data.kennzahlen} caption={`Kennzahlen ${data.label}`} />
            ) : (
              <p style={{ margin: 0 }}>Keine Kennzahlen; siehe die Hinweise oben.</p>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Bezahlen: im <Link to="/bank">Bankabgleich</Link> mit „Lohnsteuer an das Finanzamt“; Haben schlägt das vor, wenn eine Lastschrift des Finanzamts
              genau den Gesamtbetrag (Kz 83) einer übermittelten Anmeldung hat.
            </p>
          </section>
          <Abrechnungen data={data} />
          <Turnus data={data} />
        </div>
        <Senden data={data} />
      </div>
    </>
  );
}

function teileText(t: Jahresteile): string {
  const teile = [
    t.vorjahr !== 0 ? `Vorjahr ${formatEuro(t.vorjahr)}` : null,
    t.folgejahr !== 0 ? `Folgejahr ${formatEuro(t.folgejahr)}` : null,
    t.vorjahr !== 0 || t.folgejahr !== 0 ? `laufendes Jahr ${formatEuro(t.lfdJahr)}` : null,
  ].filter(Boolean);
  return teile.join(", ");
}

interface Zeile {
  kz: string;
  bezeichnung: string;
  teile: Jahresteile | null;
  wert: string;
}

function KennzahlenTable({ kennzahlen: k, caption }: { kennzahlen: LstaKennzahlen; caption: string }) {
  const kirche = (kz: "61" | "62" | "63", bezeichnung: string): Zeile[] => {
    const teile = k.kirche[`kz${kz}`];
    return summeJahresteile(teile) !== 0 ? [{ kz, bezeichnung, teile, wert: formatEuro(summeJahresteile(teile)) }] : [];
  };
  const zeilen: Zeile[] = [
    { kz: "42", bezeichnung: "Summe der einzubehaltenden Lohnsteuer", teile: k.kz42, wert: formatEuro(summeJahresteile(k.kz42)) },
    { kz: "48", bezeichnung: "Verbleiben", teile: null, wert: formatEuro(k.kz48) },
    { kz: "49", bezeichnung: "Solidaritätszuschlag", teile: k.kz49, wert: formatEuro(summeJahresteile(k.kz49)) },
    ...kirche("61", "Evangelische Kirchensteuer"),
    ...kirche("62", "Römisch-Katholische Kirchensteuer"),
    ...kirche("63", "Alt-Katholische Kirchensteuer"),
    { kz: "83", bezeichnung: "Gesamtbetrag", teile: null, wert: formatEuro(k.kz83) },
    { kz: "86", bezeichnung: "Zahl der Arbeitnehmer", teile: null, wert: String(k.kz86) },
  ];
  return (
    <table>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th>Kz</th>
          <th>Bezeichnung</th>
          <th className="num">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map(({ kz, bezeichnung, teile, wert }) => (
          <tr key={kz}>
            <td>{kz}</td>
            <th scope="row" style={{ fontWeight: kz === "83" ? 600 : 400 }}>
              {bezeichnung}
              {teile && teileText(teile) && <div className="small muted">{teileText(teile)}</div>}
            </th>
            <td className="num">{wert}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Abrechnungen({ data }: { data: Data }) {
  if (data.abrechnungen.length === 0) {
    return (
      <section className="card" aria-labelledby="lsta-abrechnungen-heading">
        <h2 id="lsta-abrechnungen-heading">Abrechnungen</h2>
        <p style={{ margin: 0 }}>
          Keine festgeschriebene Abrechnung mit Zahltag in diesem Zeitraum. <Link to="/lohn">Zur Lohnabrechnung</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="lsta-abrechnungen-heading">
      <h2 id="lsta-abrechnungen-heading">Abrechnungen ({data.abrechnungen.length})</h2>
      <table>
        <caption className="visually-hidden">Abrechnungen der Anmeldung</caption>
        <thead>
          <tr>
            <th>Zahltag</th>
            <th>Mitarbeiter</th>
            <th className="num">Lohnsteuer</th>
            <th className="num">Soli</th>
            <th className="num">Kirchensteuer</th>
          </tr>
        </thead>
        <tbody>
          {data.abrechnungen.map((a) => (
            <tr key={a.id}>
              <td className="date">{formatDate(a.zahltag)}</td>
              <td>
                <Link to="/lohn" search={{ jahr: a.year, monat: a.month }}>
                  {a.name}
                </Link>
                <div className="small muted">
                  {monatsname(a.year, a.month)} · {BESCHAEFTIGUNGSARTEN[a.art]}
                  {a.pauschsteuer > 0 ? ` · Pauschsteuer ${formatEuro(a.pauschsteuer)} an die Minijob-Zentrale` : ""}
                </div>
              </td>
              <td className="num">{formatEuro(a.lohnsteuer)}</td>
              <td className="num">{formatEuro(a.soli)}</td>
              <td className="num">{formatEuro(a.kirchensteuer)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Turnus({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveLstaTurnusFn);
  const action = useAction();
  const selectId = useId();
  const { turnus } = data;
  const [wahl, setWahl] = useState<LstaTurnus | "vorschlag">(turnus.eigen ? turnus.turnus : "vorschlag");

  return (
    <section className="card stack" aria-labelledby="lsta-turnus-heading" style={{ gap: 8 }}>
      <h2 id="lsta-turnus-heading" style={{ margin: 0 }}>
        Anmeldungszeitraum {turnus.year}
      </h2>
      <p className="small" style={{ margin: 0 }}>
        {LSTA_TURNUS_LABEL[turnus.turnus]}
        {turnus.eigen ? " (festgelegt)" : turnus.vorschlag ? " (Vorschlag)" : " (Grundsatz, § 41a Abs. 2 Satz 1 EStG)"}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        {turnus.vorschlag?.grund ?? "Für einen Vorschlag fehlt Haben die Lohnsteuer des Vorjahres."} Maßgeblich ist, was das Finanzamt festlegt.
      </p>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await save({ data: { year: turnus.year, turnus: wahl === "vorschlag" ? null : wahl } });
            await router.invalidate();
            action.setNotice({ tone: "ok", text: "Anmeldungszeitraum gespeichert." });
          });
        }}
      >
        <label className="field" htmlFor={selectId}>
          Anmeldungszeitraum {turnus.year}
          <select id={selectId} value={wahl} onChange={(e) => setWahl(e.target.value as LstaTurnus | "vorschlag")}>
            <option value="vorschlag">wie vorgeschlagen</option>
            <option value="monatlich">monatlich</option>
            <option value="vierteljaehrlich">vierteljährlich</option>
            <option value="jaehrlich">jährlich</option>
          </select>
        </label>
        <button type="submit" className="btn" disabled={action.busy}>
          Speichern
        </button>
      </form>
      <NoticeBanner notice={action.notice} />
    </section>
  );
}

function Senden({ data }: { data: Data }) {
  const router = useRouter();
  const submit = useServerFn(submitLstaFn);
  const action = useAction();
  const { naechste } = data;
  const fehler = data.issues.some((i) => i.tone === "error");

  const onSubmit = (kind: ElsterKind, pin?: string) =>
    action.run(async () => {
      const result = await submit({ data: { zeitraum: data.zeitraum, kind, pin } });
      await router.invalidate();
      action.setNotice(elsterNotice(kind, result, naechste?.berichtigt ? "Berichtigte Anmeldung übermittelt." : "Anmeldung an das Finanzamt übermittelt."));
    });

  return (
    <div className="stack">
      {data.sent && (
        <section className="card" aria-labelledby="lsta-status-heading">
          <h2 id="lsta-status-heading">Übermittelt</h2>
          <p className="small" style={{ margin: 0 }}>
            {data.abweichend
              ? "Seit der Übermittlung haben sich die Abrechnungen geändert, etwa durch ein Storno. Sende eine berichtigte Anmeldung (Kz 10) mit allen Werten des Zeitraums."
              : "Die Anmeldung ist beim Finanzamt und stimmt mit den Abrechnungen überein. Ändert sich etwas, sendest du hier eine berichtigte Anmeldung."}
          </p>
          {data.abweichend && data.gemeldet && <KennzahlenTable kennzahlen={data.gemeldet} caption="Zuletzt gemeldet" />}
        </section>
      )}
      {naechste && (
        <ElsterSubmit
          setup={data}
          title={naechste.berichtigt ? "Berichtigte Anmeldung senden" : "Anmeldung an das Finanzamt"}
          ready={!fehler}
          busy={action.busy}
          notice={action.notice}
          lockedHint={data.abgelaufen ? undefined : "Echt senden geht erst nach Ablauf des Zeitraums."}
          confirmTitle={`${naechste.berichtigt ? "Berichtigte " : ""}Lohnsteuer-Anmeldung ${data.label} verbindlich senden?`}
          confirmText={`Die ${naechste.berichtigt ? "berichtigte " : ""}Lohnsteuer-Anmeldung ${data.label} geht verbindlich an das Finanzamt.`}
          footer="Lohnsteuer-Anmeldung (Datenart LStA) über ERiC. Das Übertragungsprotokoll wird als PDF abgelegt. Die PIN wird nicht gespeichert."
          onSubmit={onSubmit}
        />
      )}
      {data.ausfuellliste && (
        <section className="card stack" aria-labelledby="lsta-mein-elster-heading" style={{ gap: 8 }}>
          <h2 id="lsta-mein-elster-heading" style={{ margin: 0 }}>
            In Mein ELSTER eintragen
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            Ohne eigene Hersteller-ID gibst du in Mein ELSTER ab: Formular „Lohnsteuer-Anmeldung {data.zeitraum.year}“, Zeitraum {data.ausfuellliste.zeitraum},
            dann diese Werte. Prüfen und absenden machst du dort; Haben erfährt davon nichts.
          </p>
          <table>
            <caption className="visually-hidden">Ausfüllliste für Mein ELSTER</caption>
            <thead>
              <tr>
                <th>Feld</th>
                <th className="num">Eingabe</th>
              </tr>
            </thead>
            <tbody>
              {data.ausfuellliste.felder.map((f) => (
                <tr key={f.kennung}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    {f.bezeichnung}
                  </th>
                  <td className="num">{f.eingabe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {data.submissions.length > 0 && (
        <section className="card" aria-labelledby="lsta-verlauf-heading">
          <h2 id="lsta-verlauf-heading">Verlauf</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {data.submissions.map((entry) => (
              <li key={entry.id}>
                {ELSTER_KIND_LABEL[entry.kind]}
                {entry.berichtigt ? " (Berichtigung)" : ""} {entry.ok ? "OK" : `Fehler ${entry.code}`} · {formatDateTime(entry.createdAt)} · Kz 83{" "}
                {formatEuro(entry.kennzahlen.kz83)}
                {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
                {!entry.ok ? ` · ${entry.message}` : ""}
                {entry.hasPdf && (
                  <>
                    {" · "}
                    <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer">
                      Protokoll
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
