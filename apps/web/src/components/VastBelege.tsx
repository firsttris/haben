import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage, formatDateTime } from "../lib/format.ts";
import { formatWert } from "../lib/vast.ts";
import type { getAnnualReturns } from "../server/functions/annual.ts";
import { fetchVast } from "../server/functions/annual.ts";

type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
type Beleg = Data["vast"]["belege"][number];
type Notice = { tone: "ok" | "danger"; text: string } | null;

function BelegDetails({ beleg }: { beleg: Beleg }) {
  return (
    <details className="history-row" style={{ display: "block" }}>
      <summary style={{ cursor: "pointer" }}>
        <span style={{ fontWeight: 500 }}>{beleg.label}</span>
        {beleg.test && (
          <>
            {" "}
            <span className="pill pill-info">Test</span>
          </>
        )}{" "}
        <span className="small muted">abgeholt {formatDateTime(beleg.fetchedAt)}</span>
      </summary>
      {beleg.lesbar ? (
        <table className="report-table" style={{ marginTop: 8 }}>
          <tbody>
            {beleg.werte.map((w, i) => (
              <tr key={i}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  {w.pfad.length > 1 && <span className="small muted">{w.pfad.slice(0, -1).join(" › ")} › </span>}
                  {w.pfad.at(-1)}
                </th>
                <td className="num" style={{ overflowWrap: "anywhere" }}>
                  {formatWert(w.pfad, w.wert)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="small" style={{ margin: "8px 0 0" }}>
          Der Beleg ließ sich nicht lesen.
        </p>
      )}
      <p className="small" style={{ margin: "8px 0 0" }}>
        <a href={`/api/vast/${beleg.id}`} target="_blank" rel="noreferrer">
          Beleg als XML
        </a>
      </p>
    </details>
  );
}

/** Belege der vorausgefüllten Steuererklärung: anzeigen und von ELSTER abholen */
export function VastBelege({ data }: { data: Data }) {
  const router = useRouter();
  const fetchBelege = useServerFn(fetchVast);
  const { vast } = data;
  const [person, setPerson] = useState<"a" | "b">("a");
  const [pin, setPin] = useState("");
  const [testOnly, setTestOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const live = !testOnly && data.herstellerIdConfigured;
  const canUseSavedPin = vast.pinSaved && live;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await fetchBelege({ data: { year: data.year, person, kind: live ? "send" : "test", pin: pin || undefined } });
      const parts = [result.message];
      if (result.fehler.length > 0) parts.push(`${result.fehler.length} Beleg(e) nicht lesbar: ${result.fehler.map((f) => f.fehler).join("; ")}.`);
      setNotice({ tone: result.ok && result.fehler.length === 0 ? "ok" : "danger", text: parts.join(" ") });
      setPin("");
      await router.invalidate();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="vast-heading">
      <h2 id="vast-heading">Belege von ELSTER {data.year}</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Was Arbeitgeber, Rentenversicherung, Krankenkasse und andere Stellen dem Finanzamt für {data.year} gemeldet haben
        (vorausgefüllte Steuererklärung). Zum Abgleich mit deinen Angaben oben; Haben übernimmt die Werte nicht von selbst in die Erklärung.
      </p>
      <div className="grid-main">
        <div className="stack" style={{ gap: 12 }}>
          {vast.personen.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Für den Abruf braucht Haben die Steuer-IdNr. Trage die persönlichen Angaben in den Einstellungen ein.
            </p>
          ) : vast.belege.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Noch keine Belege abgeholt. Die meisten Meldungen liegen ab Ende Februar des Folgejahres vor.
            </p>
          ) : (
            vast.personen.map((p) => {
              const belege = vast.belege.filter((b) => b.person === p.key);
              if (belege.length === 0) return null;
              return (
                <div key={p.key}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{p.name}</h3>
                  {belege.map((b) => (
                    <BelegDetails key={b.id} beleg={b} />
                  ))}
                </div>
              );
            })
          )}
        </div>
        {vast.personen.length > 0 && (
          <form className="stack" style={{ gap: 12 }} onSubmit={onSubmit} aria-label="Belege abrufen">
            {vast.personen.length > 1 && (
              <label className="field">
                Für
                <select value={person} onChange={(e) => setPerson(e.target.value as "a" | "b")}>
                  {vast.personen.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {person === "b" && (
              <p className="small muted" style={{ margin: 0 }}>
                Für die Belege des Ehegatten braucht dein Zertifikat eine Abrufberechtigung. Die beantragst du in Mein ELSTER; der
                Freischaltcode kommt per Post an den Ehegatten.
              </p>
            )}
            <label className="field">
              Zertifikats-PIN
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
                placeholder={canUseSavedPin ? "gespeicherte PIN verwenden" : undefined}
              />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={testOnly || !data.herstellerIdConfigured} disabled={!data.herstellerIdConfigured} onChange={(e) => setTestOnly(e.target.checked)} />
              Nur testweise abrufen
            </label>
            {!data.herstellerIdConfigured && (
              <p className="small muted" style={{ margin: 0 }}>
                {data.mode === "simuliert"
                  ? "Der Testabruf läuft ohne ERiC simuliert und liefert Beispielbelege."
                  : "Echter Abruf erst mit eigener Hersteller-ID (ELSTER_HERSTELLER_ID)."}
              </p>
            )}
            {notice && (
              <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>
                {notice.text}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || !data.certificate || (pin.length === 0 && !canUseSavedPin)}>
              {busy ? "Läuft …" : live ? "Belege abrufen" : "Testweise abrufen"}
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              {vast.last
                ? `Zuletzt ${formatDateTime(vast.last.createdAt)}${vast.last.test ? " (Test)" : ""}${vast.last.ok ? "" : `: ${vast.last.message}`}.`
                : "Die Belege lassen sich beliebig oft abrufen."}
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
