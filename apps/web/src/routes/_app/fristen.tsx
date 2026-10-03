import { tageBis } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { createFristenAbo, getFristen, revokeFristenAbo } from "../../server/functions/fristen.ts";
import styles from "../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/fristen")({
  loader: () => getFristen(),
  head: () => ({ meta: [{ title: "Fristen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: FristenPage,
});

type Data = Awaited<ReturnType<typeof getFristen>>;
type Frist = Data["fristen"][number];

const ART_LABEL: Record<Frist["art"], string> = {
  ustva: "Voranmeldung",
  erklaerung: "Erklärung",
  vorauszahlung: "Vorauszahlung",
  einspruch: "Einspruch",
  zertifikat: "Zertifikat",
};

function wann(datum: string, today: string): string {
  const tage = tageBis(datum, today);
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  if (tage < 0) return `seit ${-tage} Tag${tage === -1 ? "" : "en"}`;
  return `in ${tage} Tagen`;
}

function FristRow({ frist, today }: { frist: Frist; today: string }) {
  const tage = tageBis(frist.datum, today);
  const dringend = frist.status === "offen" && tage <= 7;
  return (
    <tr>
      <td data-label="Datum" style={{ whiteSpace: "nowrap" }}>
        {formatDate(frist.datum)}
        <div className="small" style={{ color: dringend ? "var(--danger-ink)" : "var(--muted)", fontWeight: dringend ? 600 : 400 }}>
          {frist.status === "erledigt" ? "erledigt" : wann(frist.datum, today)}
        </div>
      </td>
      <td data-label="Frist">
        <a href={frist.link} style={{ fontWeight: 500 }}>
          {frist.titel}
        </a>
        <div className="small muted">{frist.detail}</div>
      </td>
      <td data-label="Art">
        <span className={`pill${frist.status === "erledigt" ? " pill-ok" : frist.status === "hinweis" ? " pill-info" : ""}`}>{ART_LABEL[frist.art]}</span>
      </td>
    </tr>
  );
}

function Gruppe({ titel, fristen, today, leer }: { titel: string; fristen: Frist[]; today: string; leer?: string }) {
  if (fristen.length === 0 && !leer) return null;
  const id = `fristen-${titel.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id} style={{ margin: 0, fontSize: 16 }}>
        {titel} <span className="small muted">({fristen.length})</span>
      </h2>
      {fristen.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {leer}
        </p>
      ) : (
        <table className="report-table stack-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 140 }}>
                Datum
              </th>
              <th scope="col">Frist</th>
              <th scope="col" style={{ width: 130 }}>
                Art
              </th>
            </tr>
          </thead>
          <tbody>
            {fristen.map((f) => (
              <FristRow key={f.id} frist={f} today={today} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FristenPage() {
  const { today, fristen } = Route.useLoaderData();
  const bald = (f: Frist) => tageBis(f.datum, today) <= 30;
  const ueberfaellig = fristen.filter((f) => f.status === "offen" && f.datum < today);
  const naechste = fristen.filter((f) => f.status !== "erledigt" && f.datum >= today && bald(f));
  const spaeter = fristen.filter((f) => f.status !== "erledigt" && !bald(f));
  const erledigt = fristen.filter((f) => f.status === "erledigt").reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Steuertermine</div>
          <h1>Fristen</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Voranmeldungen, Jahreserklärungen, Vorauszahlungen, Einspruchsfristen aus dem <Link to="/finanzamt">ELSTER-Postfach</Link> und der
        Ablauf des Zertifikats. Fällt eine Frist auf ein Wochenende oder einen Feiertag, gilt der nächste Werktag. Erledigt ist, was echt
        übermittelt ist.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {ueberfaellig.length > 0 && <Gruppe titel="Überfällig" fristen={ueberfaellig} today={today} />}
        <Gruppe titel="Nächste 30 Tage" fristen={naechste} today={today} leer="In den nächsten 30 Tagen ist nichts fällig." />
        <Gruppe titel="Später" fristen={spaeter} today={today} />
        <KalenderAbo />
        {erledigt.length > 0 && (
          <details className="card">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Erledigt ({erledigt.length})</summary>
            <table className="report-table stack-table" style={{ marginTop: 8 }}>
              <tbody>
                {erledigt.map((f) => (
                  <FristRow key={f.id} frist={f} today={today} />
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </>
  );
}

/** Abo-Link für Kalender-Apps; den Link gibt es nur direkt nach dem Erzeugen */
function KalenderAbo() {
  const { abo } = Route.useLoaderData();
  const router = useRouter();
  const create = useServerFn(createFristenAbo);
  const revoke = useServerFn(revokeFristenAbo);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await router.invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const neu = () =>
    run(async () => {
      const { token } = await create();
      setCopied(false);
      setUrl(`${window.location.origin}/api/fristen/kalender?token=${token}`);
    });

  return (
    <section className="card" aria-labelledby="abo-heading">
      <h2 id="abo-heading" style={{ margin: 0, fontSize: 16 }}>
        Erinnerungen im Kalender
      </h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Abonniere die offenen Fristen in deinem Kalender (iPhone, Android, Thunderbird, Outlook). Jede Frist ist ein ganztägiger Termin mit
        Erinnerung drei Tage vorher und am Morgen des Tages; Erledigtes verschwindet beim nächsten Abgleich. Manche Kalender, etwa Google,
        übernehmen die Erinnerungen aus Abos nicht; dort stellst du sie für den abonnierten Kalender selbst ein.
      </p>
      {url ? (
        <>
          <label className="field">
            Abo-Link (wird nur jetzt angezeigt)
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <div className="actions" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
            >
              {copied ? "Kopiert" : "Link kopieren"}
            </button>
            <a className="btn" href={url.replace(/^https?:/, "webcal:")}>
              Im Kalender öffnen
            </a>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Wer den Link hat, sieht deine Fristen. Gib ihn nicht weiter; ein neuer Link macht den alten ungültig.
          </p>
        </>
      ) : abo ? (
        <>
          <p className="small" style={{ margin: 0 }}>
            Das Abo ist eingerichtet. Den Link zeigt Haben aus Sicherheitsgründen nur beim Erzeugen.
          </p>
          <div className="actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void neu()}>
              Neuen Link erzeugen
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(async () => void (await revoke()))}>
              Abo beenden
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void neu()}>
            Kalender-Abo einrichten
          </button>
        </div>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
