import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { CertificateStatus, TestOnlyToggle } from "../../components/ElsterSubmit.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { disablePostfachAutoFetch, enablePostfachAutoFetch, fetchFinanzamtPostfach } from "../../server/functions/finanzamt.ts";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { Field } from "../../components/Field.tsx";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { Status } from "../../components/Status.tsx";
import { DATENART_LABEL, type Data, STATUS_LABEL } from "./-finanzamt-daten.ts";

/** Bescheide und Mitteilungen aus dem ELSTER-Postfach */
export function Postfach({ data }: { data: Data }) {
  const router = useRouter();
  const fetchPostfach = useServerFn(fetchFinanzamtPostfach);
  const enableAuto = useServerFn(enablePostfachAutoFetch);
  const disableAuto = useServerFn(disablePostfachAutoFetch);
  const [savePin, setSavePin] = useState(false);
  const [pin, setPin] = useState("");
  const [testOnly, setTestOnly] = useState(true);
  const { busy, notice, setNotice, run } = useAction();
  const { form, error, check } = useSubmitCheck({ pin: pin.length === 0 ? "Trag die PIN des Zertifikats ein." : null });
  const live = !testOnly && data.herstellerIdConfigured;
  const pending = live ? data.pendingConfirmations.live : data.pendingConfirmations.test;
  const auto = data.autoFetch;

  const turnOff = () =>
    run(async () => {
      await disableAuto();
      await router.invalidate();
    }, "Automatischer Abruf ausgeschaltet, die PIN ist gelöscht.");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      const result = live && savePin ? await enableAuto({ data: { pin } }) : await fetchPostfach({ data: { kind: live ? "send" : "test", pin } });
      if (live && savePin) setSavePin(false);
      const parts = [result.message];
      if (result.fehler.length > 0) parts.push(`${result.fehler.length} Anhang/Anhänge nicht abgeholt: ${result.fehler.map((f) => f.fehler).join("; ")}.`);
      if (result.bestaetigungFehler) parts.push(`Bestätigung fehlgeschlagen: ${result.bestaetigungFehler}. Bitte innerhalb von 24 Stunden erneut abrufen.`);
      setNotice({ tone: result.ok && !result.bestaetigungFehler && result.fehler.length === 0 ? "ok" : "danger", text: parts.join(" ") });
      setPin("");
      await router.invalidate();
    });
  }

  return (
    <div className="grid-main">
      <section className="card" aria-labelledby="postfach-heading">
        <h2 id="postfach-heading">Bescheide aus dem ELSTER-Postfach</h2>
        {data.documents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch nichts abgeholt. Mit „Postfach abrufen“ holst du Bescheide (wenn du in Mein ELSTER der elektronischen Bekanntgabe zugestimmt hast) und
            Mitteilungen des Finanzamts hierher.
          </p>
        ) : (
          <ScrollTable className="report-table">
            <thead>
              <tr>
                <th scope="col">Dokument</th>
                <th scope="col">Jahr</th>
                <th scope="col">Einspruch bis</th>
                <th scope="col">Abgeholt</th>
              </tr>
            </thead>
            <tbody>
              {data.documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href={`/api/postfach/${d.id}`} target="_blank" rel="noreferrer">
                      {d.dateibezeichnung || d.filename}
                    </a>
                    <div className="small muted">
                      {DATENART_LABEL[d.datenart] ?? d.datenart}
                      {d.bescheiddatum ? ` vom ${d.bescheiddatumIso ? formatDate(d.bescheiddatumIso) : d.bescheiddatum}` : ""}
                      {d.test ? " · Test" : ""}
                    </div>
                  </td>
                  <td>{d.veranlagungszeitraum || "–"}</td>
                  <td className="small">
                    {d.frist ? (
                      <span style={d.frist.fristende >= data.today ? { fontWeight: 600 } : { color: "var(--muted)" }}>{formatDate(d.frist.fristende)}</span>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="small">{formatDateTime(d.fetchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
        {data.documents.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Bis zum Datum unter „Einspruch bis“ kannst du Einspruch einlegen.
          </p>
        )}
      </section>
      <form ref={form} className="card" onSubmit={onSubmit} aria-label="Postfach abrufen" noValidate>
        <h2>Postfach abrufen</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Holt alles Neue ab und bestätigt die Abholung gegenüber ELSTER.
          {data.lastFetch ? ` Zuletzt ${formatDateTime(data.lastFetch.createdAt)}${data.lastFetch.test ? " (Test)" : ""}.` : ""}
        </p>
        {pending > 0 && (
          <div className="banner" role="alert">
            {pending} Abholung{pending === 1 ? "" : "en"} noch nicht bestätigt. Rufe das Postfach erneut ab; ELSTER erwartet die Bestätigung innerhalb von 24
            Stunden.
          </div>
        )}
        <CertificateStatus certificate={data.certificate} />
        <Field label="Zertifikats-PIN" error={error("pin")}>
          {(control) => <input {...control} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />}
        </Field>
        <TestOnlyToggle setup={data} testOnly={testOnly} onChange={setTestOnly} />
        {live && !auto.enabled && (
          <label className="checkbox">
            <input type="checkbox" checked={savePin} onChange={(e) => setSavePin(e.target.checked)} />
            PIN verschlüsselt speichern und täglich automatisch abrufen
          </label>
        )}
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !data.certificate} style={{ flexGrow: 1 }}>
            {busy ? "Läuft …" : live ? (savePin ? "Abrufen und automatisch einschalten" : "Postfach abrufen") : "Testweise abrufen"}
          </button>
        </div>
        {auto.enabled ? (
          <div
            className="banner banner-info"
            role="status"
            style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            <span>
              Automatischer Abruf ist an{auto.since ? ` seit ${formatDate(auto.since)}` : ""}.
              {auto.lastLive
                ? ` Letzter Abruf ${formatDateTime(auto.lastLive.createdAt)}${auto.lastLive.ok ? "" : ` (Fehler: ${auto.lastLive.message})`}.`
                : ""}
            </span>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void turnOff()}>
              Ausschalten
            </button>
          </div>
        ) : (
          live && (
            <p className="small muted" style={{ margin: 0 }}>
              Mit gespeicherter PIN ruft Haben das Postfach einmal am Tag selbst ab und bestätigt die Abholung. Die PIN liegt dann verschlüsselt wie das
              Zertifikat in der Datenbank.
            </p>
          )
        )}
      </form>
    </div>
  );
}

export function History({ data }: { data: Data }) {
  return (
    <section className="card" aria-labelledby="history-heading" style={{ marginTop: 24 }}>
      <h2 id="history-heading">Verlauf</h2>
      {data.messages.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch keine Nachricht geprüft oder gesendet.
        </p>
      ) : (
        data.messages.map((m) => (
          <details key={m.id} className="history-row" style={{ display: "block" }}>
            <summary style={{ cursor: "pointer" }}>
              <span style={{ fontWeight: 500 }}>{m.betreff}</span>{" "}
              {m.ok ? (
                <Status tone={m.kind === "send" ? "ok" : "info"} inline>
                  {STATUS_LABEL[m.kind]}
                </Status>
              ) : (
                <Status tone="danger" emphasis="urgent" inline>
                  Fehler {m.code}
                </Status>
              )}
              <span className="small muted">
                {" "}
                · {formatDateTime(m.createdAt)}
                {m.transferTicket ? ` · Ticket ${m.transferTicket}` : ""}
              </span>
            </summary>
            {!m.ok && (
              <p className="small" style={{ overflowWrap: "anywhere" }}>
                {m.message}
              </p>
            )}
            <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "8px 0 0" }}>
              {m.text}
            </pre>
          </details>
        ))
      )}
    </section>
  );
}
