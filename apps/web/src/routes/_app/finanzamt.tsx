import { formatEuro, parseEuro } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Icon } from "../../components/Icon.tsx";
import { errorMessage, formatDate, formatDateTime } from "../../lib/format.ts";
import { getFinanzamt, sendFinanzamtMessage } from "../../server/functions/finanzamt.ts";
import styles from "../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/finanzamt")({
  loader: () => getFinanzamt(),
  head: () => ({ meta: [{ title: "Finanzamt · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: FinanzamtPage,
});

type Data = Awaited<ReturnType<typeof getFinanzamt>>;
type Topic = "vorauszahlung" | "nachricht";
type Notice = { tone: "ok" | "danger" | "info"; text: string } | null;

const KIND_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Gesendet" } as const;
const TOPIC_LABEL = { vorauszahlung: "Herabsetzung der Vorauszahlungen", nachricht: "Nachricht" } as const;

/** Formloser Antrag nach § 37 Abs. 3 EStG mit den Zahlen aus der Buchhaltung */
function prepaymentLetter(data: Data, current: number | null, wanted: number | null, reason: string) {
  const b = data.basis;
  const art = b.einkunftsart === "gewerbe" ? "Gewerbebetrieb" : "selbständiger Arbeit";
  const lines = [
    "Sehr geehrte Damen und Herren,",
    "",
    `hiermit beantrage ich, die Vorauszahlungen zur Einkommensteuer für ${b.year} ab dem nächsten Fälligkeitstermin` +
      (wanted !== null ? ` auf ${formatEuro(wanted)} je Quartal` : "") +
      " herabzusetzen (§ 37 Abs. 3 EStG).",
    "",
    `Mein Gewinn aus ${art} beträgt nach meiner Buchführung vom 1. Januar bis ${formatDate(b.until)} ${formatEuro(b.profitSoFar)}. ` +
      `Auf das Jahr hochgerechnet erwarte ich einen Gewinn von rund ${formatEuro(b.profitForecast)} (Vorjahr: ${formatEuro(b.profitLastYear)}).` +
      (current !== null ? ` Die bisher festgesetzten Vorauszahlungen von ${formatEuro(current)} je Quartal sind deshalb zu hoch.` : ""),
    ...(reason.trim() ? ["", reason.trim()] : []),
    "",
    "Eine Gewinnermittlung für den bisherigen Zeitraum reiche ich auf Anforderung gerne nach.",
    "",
    "Mit freundlichen Grüßen",
    data.company.name,
  ];
  return { betreff: `Antrag auf Herabsetzung der Einkommensteuer-Vorauszahlungen ${b.year}`, text: lines.join("\n") };
}

function FinanzamtPage() {
  const data = Route.useLoaderData();
  const [topic, setTopic] = useState<Topic>("vorauszahlung");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Über ELSTER</div>
          <h1>Finanzamt</h1>
        </div>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>
            ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.{" "}
            <Link to="/einstellungen">ERiC einrichten</Link>
          </span>
        </div>
      )}
      {data.issues.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Firmendaten unvollständig: {data.issues.join(", ")}. <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
          </span>
        </div>
      )}

      <div role="group" aria-label="Art der Nachricht" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {(["vorauszahlung", "nachricht"] as const).map((t) => (
          <button key={t} type="button" className={`chip${topic === t ? " active" : ""}`} aria-pressed={topic === t} onClick={() => setTopic(t)}>
            {t === "vorauszahlung" ? "Vorauszahlungen herabsetzen" : "Freie Nachricht"}
          </button>
        ))}
      </div>

      {topic === "vorauszahlung" ? <PrepaymentForm key="v" data={data} /> : <MessageForm key="n" data={data} topic="nachricht" initial={{ betreff: "", text: "" }} />}

      <History data={data} />
    </>
  );
}

function PrepaymentForm({ data }: { data: Data }) {
  const [current, setCurrent] = useState("");
  const [wanted, setWanted] = useState("");
  const [reason, setReason] = useState("");
  const b = data.basis;
  const currentCents = current.trim() ? parseEuro(current) : null;
  const wantedCents = wanted.trim() ? parseEuro(wanted) : null;
  const letter = prepaymentLetter(data, currentCents, wantedCents, reason);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="basis-heading">
        <h2 id="basis-heading">Einkommensteuer-Vorauszahlungen {b.year}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Das Finanzamt setzt die Vorauszahlungen (fällig 10.3., 10.6., 10.9. und 10.12.) nach dem letzten Bescheid fest. Verdienst du
          weniger, kannst du formlos eine Herabsetzung beantragen. Haben schreibt den Antrag mit den Zahlen aus deiner EÜR; du prüfst
          den Text und schickst ihn als Nachricht an dein Finanzamt.
        </p>
        <table className="report-table" style={{ maxWidth: 520 }}>
          <tbody>
            <tr>
              <th scope="row">Gewinn 1. Januar bis {formatDate(b.until)}</th>
              <td className="num">{formatEuro(b.profitSoFar)}</td>
            </tr>
            <tr>
              <th scope="row">Hochgerechnet auf {b.year}</th>
              <td className="num">{formatEuro(b.profitForecast)}</td>
            </tr>
            <tr>
              <th scope="row">Gewinn {b.year - 1}</th>
              <td className="num">{formatEuro(b.profitLastYear)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 200px" }}>
            Bisherige Vorauszahlung je Quartal (€)
            <input inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="laut letztem Bescheid" aria-invalid={current.trim() !== "" && currentCents === null} />
          </label>
          <label className="field" style={{ flex: "1 1 200px" }}>
            Gewünschte Vorauszahlung je Quartal (€)
            <input inputMode="decimal" value={wanted} onChange={(e) => setWanted(e.target.value)} placeholder="z. B. 1.000,00" aria-invalid={wanted.trim() !== "" && wantedCents === null} />
          </label>
        </div>
        <label className="field">
          Weitere Begründung (optional)
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. ein großer Auftrag ist weggefallen" />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          Die Hochrechnung nimmt den bisherigen Gewinn taggenau aufs Jahr. Welche Vorauszahlung passt, hängt von deiner gesamten
          Einkommensteuer ab (weitere Einkünfte, Sonderausgaben, Zusammenveranlagung); die Zahl trägst du deshalb selbst ein.
        </p>
      </section>
      <MessageForm key={`${letter.betreff}|${letter.text}`} data={data} topic="vorauszahlung" initial={letter} figures={{ ...b, current: currentCents, wanted: wantedCents }} />
    </div>
  );
}

function MessageForm({
  data,
  topic,
  initial,
  figures,
}: {
  data: Data;
  topic: Topic;
  initial: { betreff: string; text: string };
  figures?: Record<string, unknown>;
}) {
  const router = useRouter();
  const send = useServerFn(sendFinanzamtMessage);
  const [betreff, setBetreff] = useState(initial.betreff);
  const [text, setText] = useState(initial.text);
  const [pin, setPin] = useState("");
  const [testOnly, setTestOnly] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const canSendLive = data.herstellerIdConfigured;
  const ready = data.issues.length === 0 && betreff.trim() !== "" && text.trim() !== "";

  async function run(kind: "validate" | "test" | "send", withPin?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await send({ data: { topic, betreff, text, figures: figures ?? null, kind, pin: withPin } });
      const ticket = result.transferTicket ? ` Transfer-Ticket ${result.transferTicket}.` : "";
      setNotice(
        result.ok
          ? { tone: "ok", text: kind === "validate" ? "Prüfung ohne Fehler." : kind === "test" ? `Testübermittlung erfolgreich.${ticket}` : `An das Finanzamt gesendet.${ticket}` }
          : { tone: "danger", text: `${KIND_LABEL[kind]} fehlgeschlagen (${result.code}): ${result.message}` },
      );
      await router.invalidate();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const live = !testOnly && canSendLive;
    if (live && !confirming) {
      setConfirming(true);
      return;
    }
    await run(live ? "send" : "test", pin);
    setPin("");
    setConfirming(false);
  }

  return (
    <form className="grid-main" onSubmit={onSubmit} aria-label={TOPIC_LABEL[topic]}>
      <section className="card">
        <h2>{topic === "vorauszahlung" ? "Antrag" : "Nachricht an das Finanzamt"}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          An {data.company.finanzamt || "das Finanzamt"} zur Steuernummer {data.company.steuernummer || "–"}. Für Einzelunternehmer ist das
          meist auch die Steuernummer der Einkommensteuer.
        </p>
        <label className="field">
          Betreff
          <input value={betreff} onChange={(e) => setBetreff(e.target.value)} maxLength={99} required />
        </label>
        <label className="field">
          Text
          <textarea rows={topic === "vorauszahlung" ? 14 : 10} value={text} onChange={(e) => setText(e.target.value)} maxLength={15_000} required />
          <span className="small muted">{text.length} von 15.000 Zeichen</span>
        </label>
      </section>
      <section className="card" aria-label="Senden">
        <h2>Über ELSTER senden</h2>
        {!data.certificate && (
          <p className="small" style={{ margin: 0 }}>
            Kein ELSTER-Zertifikat hinterlegt. <Link to="/einstellungen">In den Einstellungen hochladen</Link>
          </p>
        )}
        <label className="field">
          Zertifikats-PIN
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={testOnly || !canSendLive}
            onChange={(e) => {
              setTestOnly(e.target.checked);
              setConfirming(false);
            }}
            disabled={!canSendLive}
          />
          Nur Testübermittlung
        </label>
        {!canSendLive && (
          <p className="small muted" style={{ margin: 0 }}>
            {data.mode === "simuliert" ? "Echtes Senden erst mit eingerichtetem ERiC und eigener Hersteller-ID." : "Echtes Senden erst mit eigener Hersteller-ID (ELSTER_HERSTELLER_ID)."}
          </p>
        )}
        {confirming && (
          <div className="banner" role="alert">
            Die Nachricht geht an das Finanzamt. Noch einmal klicken zum Senden.
          </div>
        )}
        {notice && (
          <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>
            {notice.text}
          </div>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !ready || !data.certificate || pin.length === 0} style={{ flexGrow: 1 }}>
            {busy ? "Läuft …" : confirming ? "Jetzt verbindlich senden" : testOnly || !canSendLive ? "Testweise senden" : "Senden"}
          </button>
          <button type="button" className="btn" disabled={busy || !ready} onClick={() => void run("validate")}>
            Nur prüfen
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Die Antwort des Finanzamts kommt als Brief oder in dein ELSTER-Postfach. Die PIN wird nicht gespeichert.
        </p>
      </section>
    </form>
  );
}

function History({ data }: { data: Data }) {
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
              <span className={`pill ${m.ok ? (m.kind === "send" ? "pill-ok" : "pill-info") : "pill-danger"}`}>
                {m.ok ? KIND_LABEL[m.kind] : `Fehler ${m.code}`}
              </span>
              <span className="small muted">
                {" "}
                · {formatDateTime(m.createdAt)}
                {m.transferTicket ? ` · Ticket ${m.transferTicket}` : ""}
              </span>
            </summary>
            {!m.ok && <p className="small" style={{ overflowWrap: "anywhere" }}>{m.message}</p>}
            <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "8px 0 0" }}>{m.text}</pre>
          </details>
        ))
      )}
    </section>
  );
}
