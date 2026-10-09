import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction, type Notice } from "../lib/use-action.ts";
import { formatWert } from "../lib/vast.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import type { getAnnualReturns } from "../server/functions/annual.ts";
import {
  activateVastBerechtigung,
  fetchVast,
  refreshVastBerechtigung,
  requestVastBerechtigung,
  revokeVastBerechtigung,
} from "../server/functions/annual.ts";

type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
type Beleg = Data["vast"]["belege"][number];

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
  const action = useAction();
  const { busy, notice } = action;
  const live = !testOnly && data.herstellerIdConfigured;
  const canUseSavedPin = vast.pinSaved && live;

  const canSend = Boolean(data.certificate) && (pin.length > 0 || canUseSavedPin);

  /** Führt einen ELSTER-Schritt aus und zeigt das Ergebnis; die PIN wird danach geleert */
  const run = (work: (base: { kind: "test" | "send"; pin?: string }) => Promise<Notice>) =>
    action.run(async () => {
      action.setNotice(await work({ kind: live ? "send" : "test", pin: pin || undefined }));
      setPin("");
      await router.invalidate();
    });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async (base) => {
      const result = await fetchBelege({ data: { year: data.year, person, ...base } });
      const parts = [result.message];
      if (result.fehler.length > 0) parts.push(`${result.fehler.length} Beleg(e) nicht lesbar: ${result.fehler.map((f) => f.fehler).join("; ")}.`);
      return { tone: result.ok && result.fehler.length === 0 ? "ok" : "danger", text: parts.join(" ") };
    });
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
                  : "ERiC nimmt Abrufe, auch zum Test, nur mit eigener Hersteller-ID an (ELSTER_HERSTELLER_ID)."}
              </p>
            )}
            {person === "b" && (
              <BerechtigungPanel
                data={data}
                live={live}
                name={vast.personen.find((p) => p.key === "b")?.name.split(" ")[0] ?? "Ehegatte"}
                busy={busy}
                canSend={canSend}
                run={run}
              />
            )}
            <NoticeBanner notice={notice} />
            <button type="submit" className="btn btn-primary" disabled={busy || !canSend}>
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

const STATUS_LABEL: Record<string, string> = {
  offen: "beantragt, wartet auf Freischaltung",
  genehmigt: "genehmigt",
  widerrufen: "widerrufen",
  abgelaufen: "abgelaufen",
  abgelehnt: "abgelehnt",
};

/**
 * Berechtigung für die Belege des Ehegatten: beantragen, mit dem Code aus dem Brief freischalten,
 * widerrufen und den Stand bei ELSTER prüfen. PIN und Test/echt kommen aus dem Formular darüber.
 */
function BerechtigungPanel({
  data,
  live,
  name,
  busy,
  canSend,
  run,
}: {
  data: Data;
  live: boolean;
  name: string;
  busy: boolean;
  canSend: boolean;
  run: (work: (base: { kind: "test" | "send"; pin?: string }) => Promise<Notice>) => Promise<unknown>;
}) {
  const request = useServerFn(requestVastBerechtigung);
  const activate = useServerFn(activateVastBerechtigung);
  const revoke = useServerFn(revokeVastBerechtigung);
  const refresh = useServerFn(refreshVastBerechtigung);
  const { berechtigung: b } = data.vast;
  const current = live ? b.live : b.test;
  const [gueltigBis, setGueltigBis] = useState(b.gueltigBisVorschlag);
  const [code, setCode] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const status = current?.status;
  const disabled = busy || !canSend;
  const tone = (ok: boolean) => (ok ? "ok" : "danger") as "ok" | "danger";

  return (
    <div className="banner banner-info stack" role="group" aria-label={`Berechtigung für ${name}`} style={{ gap: 8, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
      <div>
        <strong>Berechtigung für {name}</strong>
        {current ? (
          <span>
            : {STATUS_LABEL[current.status] ?? current.status}
            {current.test ? " (Test)" : ""}
          </span>
        ) : (
          <span>: noch keine{live ? "" : " (Test)"}</span>
        )}
      </div>
      {status === "offen" && (
        <p className="small" style={{ margin: 0 }}>
          Beantragt am {formatDate(current!.beantragtAm)}. {name} bekommt von ELSTER einen Brief mit dem Freischaltcode
          {current!.genehmigenBis ? `; einzugeben bis ${formatDate(current!.genehmigenBis)}` : ""}.
        </p>
      )}
      {status === "genehmigt" && (
        <p className="small" style={{ margin: 0 }}>
          Haben darf die Belege von {name} abrufen{current!.gueltigBis ? `, bis ${formatDate(current!.gueltigBis)}` : ""}.
        </p>
      )}
      {(!status || !["offen", "genehmigt"].includes(status)) && (
        <>
          <p className="small" style={{ margin: 0 }}>
            Für die Belege von {name} braucht dein Zertifikat ihre Zustimmung: Haben beantragt das Recht bei ELSTER, {name} bekommt einen
            Brief mit Freischaltcode, den du hier eingibst.
          </p>
          <label className="field">
            Gültig bis
            <input type="date" value={gueltigBis} onChange={(e) => setGueltigBis(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn"
            disabled={disabled || !gueltigBis}
            onClick={() =>
              void run(async (base) => {
                const result = await request({ data: { ...base, gueltigBis } });
                return { tone: tone(result.ok), text: result.message };
              })
            }
          >
            Berechtigung beantragen
          </button>
        </>
      )}
      {status === "offen" && (
        <>
          <label className="field">
            Freischaltcode aus dem Brief
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
          </label>
          <button
            type="button"
            className="btn"
            disabled={disabled || code.trim().length === 0}
            onClick={() =>
              void run(async (base) => {
                const result = await activate({ data: { ...base, freischaltcode: code } });
                if (result.ok) setCode("");
                return { tone: tone(result.ok), text: result.message };
              })
            }
          >
            Freischalten
          </button>
        </>
      )}
      <div className="actions" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() =>
            void run(async (base) => {
              const result = await refresh({ data: base });
              return { tone: tone(result.ok), text: result.message };
            })
          }
        >
          Stand bei ELSTER prüfen
        </button>
        {(status === "offen" || status === "genehmigt") && (
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => {
              if (!confirmRevoke) return setConfirmRevoke(true);
              setConfirmRevoke(false);
              void run(async (base) => {
                const result = await revoke({ data: base });
                return { tone: tone(result.ok), text: result.message };
              });
            }}
          >
            {confirmRevoke ? "Wirklich widerrufen?" : status === "offen" ? "Antrag zurückziehen" : "Widerrufen"}
          </button>
        )}
      </div>
    </div>
  );
}
