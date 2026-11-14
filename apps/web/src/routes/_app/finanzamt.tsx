import { formatDecimal, formatEuro, parseEuro } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type ReactNode } from "react";
import { CertificateStatus, ElsterSubmit, TestOnlyToggle } from "../../components/ElsterSubmit.tsx";
import { Icon } from "../../components/Icon.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { elsterNotice, finanzamtFakten, type ElsterKind } from "../../lib/elster.ts";
import type { ConfirmFact } from "../../components/ConfirmDialog.tsx";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import {
  disablePostfachAutoFetch,
  enablePostfachAutoFetch,
  fetchFinanzamtPostfach,
  getFinanzamt,
  sendFinanzamtBankChange,
  sendFinanzamtMessage,
} from "../../server/functions/finanzamt.ts";
import { today } from "../../server/today.ts";
import styles from "../../styles/auswertungen.css?url";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { Field } from "../../components/Field.tsx";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { Status } from "../../components/Status.tsx";

export const Route = createFileRoute("/_app/finanzamt")({
  // Datum in Deutschland, nicht UTC; kommt beim ersten Aufruf mit den Loader-Daten vom Server
  loader: async () => ({ ...(await getFinanzamt()), today: today() }),
  head: () => ({ meta: [{ title: "Finanzamt · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: FinanzamtPage,
});

type Data = Awaited<ReturnType<typeof getFinanzamt>> & { today: string };
/** Zahlen für die Herabsetzung; nur im Einzelunternehmen, eine GmbH oder UG hat keine Einkommensteuer-Vorauszahlungen */
type Basis = NonNullable<Data["basis"]>;
type Topic = "vorauszahlung" | "nachricht";
type Tab = Topic | "bankverbindung";
type SendResult = { ok: boolean; code: number; message: string; transferTicket: string | null };

/** Status im Verlauf */
const STATUS_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Gesendet" } as const;
const TOPIC_LABEL = { vorauszahlung: "Herabsetzung der Vorauszahlungen", nachricht: "Nachricht", bankverbindung: "Bankverbindung ändern" } as const;
const TAB_LABEL = { vorauszahlung: "Vorauszahlungen herabsetzen", nachricht: "Freie Nachricht", bankverbindung: "Bankverbindung ändern" } as const;
const DATENART_LABEL: Record<string, string> = {
  ESB: "Steuerbescheid (Daten)",
  EPMitteilung: "Mitteilung",
  DivaBescheidESt: "Einkommensteuerbescheid",
  DivaBescheidUSt: "Umsatzsteuerbescheid",
  DivaBescheidGewSt: "Gewerbesteuer-Messbescheid",
  DivaBescheidKSt: "Körperschaftsteuerbescheid",
  DivaBescheidFEIN: "Feststellungsbescheid",
  DivaSonstigerVA: "Sonstiger Bescheid",
};

/** Formloser Antrag nach § 37 Abs. 3 EStG mit den Zahlen aus der Buchhaltung */
function prepaymentLetter(data: Data, b: Basis, current: number | null, wanted: number | null, reason: string, usePrognose: boolean) {
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
    ...(usePrognose
      ? [
          "",
          `Nach meiner Berechnung ergibt sich daraus nach Abzug der Vorsorgeaufwendungen und Sonderausgaben eine voraussichtliche ` +
            `Einkommensteuer von ${formatEuro(b.prognose.einkommensteuer)}` +
            (b.prognose.soli || b.prognose.kirchensteuer
              ? ` zuzüglich ${[b.prognose.soli ? `${formatEuro(b.prognose.soli)} Solidaritätszuschlag` : "", b.prognose.kirchensteuer ? `${formatEuro(b.prognose.kirchensteuer)} Kirchensteuer` : ""].filter(Boolean).join(" und ")}`
              : "") +
            ".",
        ]
      : []),
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
  const basis = data.basis;
  const tabs = basis ? (["vorauszahlung", "nachricht", "bankverbindung"] as const) : (["nachricht", "bankverbindung"] as const);
  const [tab, setTab] = useState<Tab>(tabs[0]);

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
            <Link to="/einstellungen" search={{ bereich: "elster" }}>
              ERiC einrichten
            </Link>
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

      <Postfach data={data} />

      <h2 style={{ margin: "24px 0 12px" }}>An das Finanzamt schreiben</h2>
      <div role="group" aria-label="Art der Nachricht" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t} type="button" className={`chip${tab === t ? " active" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "vorauszahlung" && basis && <PrepaymentForm key="v" data={data} basis={basis} />}
      {tab === "nachricht" && <MessageForm key="n" data={data} topic="nachricht" initial={{ betreff: "", text: "" }} />}
      {tab === "bankverbindung" && <BankChangeForm data={data} />}

      <History data={data} />
    </>
  );
}

function PrepaymentForm({ data, basis: b }: { data: Data; basis: Basis }) {
  const [current, setCurrent] = useState("");
  const p = b.prognose;
  const [wanted, setWanted] = useState(p.jeQuartal > 0 ? formatDecimal(p.jeQuartal) : "");
  const [reason, setReason] = useState("");
  const [usePrognose, setUsePrognose] = useState(true);
  const currentCents = current.trim() ? parseEuro(current) : null;
  const wantedCents = wanted.trim() ? parseEuro(wanted) : null;
  const letter = prepaymentLetter(data, b, currentCents, wantedCents, reason, usePrognose);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="basis-heading">
        <h2 id="basis-heading">Einkommensteuer-Vorauszahlungen {b.year}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Das Finanzamt setzt die Vorauszahlungen (fällig 10.3., 10.6., 10.9. und 10.12.) nach dem letzten Bescheid fest. Verdienst du weniger, kannst du
          formlos eine Herabsetzung beantragen. Haben schreibt den Antrag mit den Zahlen aus deiner EÜR; du prüfst den Text und schickst ihn als Nachricht an
          dein Finanzamt.
        </p>
        <ScrollTable className="report-table">
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
        </ScrollTable>
        <h3 style={{ margin: "8px 0 0", fontSize: "1rem" }}>Voraussichtliche Steuer {b.year}</h3>
        <ScrollTable className="report-table">
          <tbody>
            <tr>
              <th scope="row">Hochgerechneter Gewinn</th>
              <td className="num">{formatEuro(p.gesamtbetragEinkuenfte - p.einkuenfteArbeit)}</td>
            </tr>
            {p.einkuenfteArbeit !== 0 && (
              <tr>
                <th scope="row">Arbeitslohn nach Werbungskosten</th>
                <td className="num">{formatEuro(p.einkuenfteArbeit)}</td>
              </tr>
            )}
            <tr>
              <th scope="row">Vorsorge, Sonderausgaben, Kinderbetreuung, Belastungen</th>
              <td className="num">−{formatEuro(p.vorsorge + p.sonderausgaben + p.kinderbetreuung + p.aussergewoehnlich)}</td>
            </tr>
            <tr>
              <th scope="row">Zu versteuerndes Einkommen{p.kinderfreibetrag ? " (mit Kinderfreibeträgen)" : ""}</th>
              <td className="num">{formatEuro(p.zvE)}</td>
            </tr>
            <tr>
              <th scope="row">Einkommensteuer</th>
              <td className="num">{formatEuro(p.einkommensteuer)}</td>
            </tr>
            {p.soli > 0 && (
              <tr>
                <th scope="row">Solidaritätszuschlag</th>
                <td className="num">{formatEuro(p.soli)}</td>
              </tr>
            )}
            {p.kirchensteuer > 0 && (
              <tr>
                <th scope="row">Kirchensteuer</th>
                <td className="num">{formatEuro(p.kirchensteuer)}</td>
              </tr>
            )}
            {p.steuerabzug > 0 && (
              <tr>
                <th scope="row">Lohnsteuer, angerechnet</th>
                <td className="num">−{formatEuro(p.steuerabzug)}</td>
              </tr>
            )}
            <tr style={{ fontWeight: 600 }}>
              <th scope="row" style={{ fontWeight: 600 }}>
                Je Vorauszahlungstermin (ein Viertel)
              </th>
              <td className="num">{formatEuro(p.jeQuartal)}</td>
            </tr>
          </tbody>
        </ScrollTable>
        <p className="small muted" style={{ margin: 0 }}>
          {b.angabenAus === null
            ? "Ohne gespeicherte Angaben zur Einkommensteuer (Vorsorge, Kinder …) rechnet Haben nur mit dem Sonderausgaben-Pauschbetrag. "
            : b.angabenAus < b.year
              ? `Abzüge aus deinen Angaben zur Einkommensteuer ${b.angabenAus}. `
              : ""}
          Grundlage sind der Gewinn aus der Buchhaltung und der Arbeitslohn aus deinen Angaben; Vermietung und Kapitalerträge fehlen. Eine Schätzung, keine
          Steuerberechnung.{" "}
          <Link to="/jahreserklaerung/$jahr" params={{ jahr: String(b.year) }}>
            Angaben bearbeiten
          </Link>
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={usePrognose} onChange={(e) => setUsePrognose(e.target.checked)} />
          Voraussichtliche Steuer im Antrag nennen
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Bisherige Vorauszahlung je Quartal (€)" style={{ flex: "1 1 200px" }}>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="laut letztem Bescheid"
                aria-invalid={current.trim() !== "" && currentCents === null}
              />
            )}
          </Field>
          <Field label="Gewünschte Vorauszahlung je Quartal (€)" style={{ flex: "1 1 200px" }}>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={wanted}
                onChange={(e) => setWanted(e.target.value)}
                placeholder="z. B. 1.000,00"
                aria-invalid={wanted.trim() !== "" && wantedCents === null}
              />
            )}
          </Field>
        </div>
        <Field label="Weitere Begründung (optional)">
          {(control) => (
            <textarea {...control} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. ein großer Auftrag ist weggefallen" />
          )}
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          Die Hochrechnung nimmt den bisherigen Gewinn taggenau aufs Jahr. Die gewünschte Vorauszahlung ist mit einem Viertel der voraussichtlichen Steuer
          vorbelegt, du kannst sie ändern.
        </p>
      </section>
      <MessageForm data={data} topic="vorauszahlung" initial={letter} figures={{ ...b, current: currentCents, wanted: wantedCents }} />
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
  const send = useServerFn(sendFinanzamtMessage);
  // Ohne eigene Änderung folgen Betreff und Text dem Vorschlag (beim Antrag den Zahlen darüber)
  const [ownBetreff, setBetreff] = useState<string | null>(null);
  const [ownText, setText] = useState<string | null>(null);
  const betreff = ownBetreff ?? initial.betreff;
  const text = ownText ?? initial.text;
  const ready = data.issues.length === 0 && betreff.trim() !== "" && text.trim() !== "";

  return (
    <SendPanel
      data={data}
      ready={ready}
      confirmTitle="Nachricht an das Finanzamt senden?"
      confirmText="Die Nachricht geht an das Finanzamt."
      confirmFacts={[...finanzamtFakten(data.company.finanzamt, data.company.steuernummer), { label: "Betreff", value: betreff }]}
      footer="Die Antwort des Finanzamts kommt als Brief oder in dein ELSTER-Postfach. Die PIN wird nicht gespeichert."
      send={(kind, pin) => send({ data: { topic, betreff, text, figures: figures ?? null, kind, pin } })}
    >
      <section className="card" aria-label={TOPIC_LABEL[topic]}>
        <h2>{topic === "vorauszahlung" ? "Antrag" : "Nachricht an das Finanzamt"}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          An {data.company.finanzamt || "das Finanzamt"} zur Steuernummer {data.company.steuernummer || "–"}.
          {data.basis && " Für Einzelunternehmer ist das meist auch die Steuernummer der Einkommensteuer."}
        </p>
        <Field label="Betreff">
          {(control) => <input {...control} value={betreff} onChange={(e) => setBetreff(e.target.value)} maxLength={99} required />}
        </Field>
        <Field label="Text" hint={<>{text.length} von 15.000 Zeichen</>}>
          {(control) => (
            <textarea
              {...control}
              className="autogrow"
              rows={topic === "vorauszahlung" ? 14 : 10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={15_000}
              required
            />
          )}
        </Field>
      </section>
    </SendPanel>
  );
}

function BankChangeForm({ data }: { data: Data }) {
  const send = useServerFn(sendFinanzamtBankChange);
  const [iban, setIban] = useState(data.taxAccount?.iban ?? data.company.iban);
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  const plausible = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact);
  const ready = data.bankIssues.length === 0 && plausible;

  return (
    <SendPanel
      data={data}
      ready={ready}
      confirmTitle="Bankverbindung an das Finanzamt senden?"
      confirmText="Das Finanzamt nutzt danach dieses Konto für alle Steuerarten."
      confirmFacts={[
        ...finanzamtFakten(data.company.finanzamt, data.company.steuernummer),
        ...(data.person ? [{ label: "Kontoinhaber", value: `${data.person.vorname} ${data.person.name}` }] : []),
        { label: "IBAN", value: compact, strong: true },
      ]}
      footer="Gilt für Erstattungen und, falls du eine Lastschrift erteilt hast, für den Einzug. Die PIN wird nicht gespeichert."
      send={(kind, pin) => send({ data: { iban: compact, kind, pin } })}
    >
      <section className="card" aria-label={TOPIC_LABEL.bankverbindung}>
        <h2>Bankverbindung beim Finanzamt ändern</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Teilt {data.company.finanzamt || "dem Finanzamt"} zur Steuernummer {data.company.steuernummer || "–"} ein neues Konto für alle Steuerarten mit
          {data.person ? `, Kontoinhaber ${data.person.vorname} ${data.person.name}` : ""}.
        </p>
        {data.bankIssues.length > 0 && (
          <div className="banner" role="status">
            Es fehlt noch: {data.bankIssues.join(", ")}. <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
          </div>
        )}
        <Field
          label="IBAN"
          hint={
            <>
              {data.taxAccount
                ? `Vorbelegt mit deinem Steuerkonto ${data.taxAccount.name} (Zweck unter Bank). `
                : "Vorbelegt mit der IBAN aus den Firmendaten; ein Konto mit dem Zweck „Steuerkonto“ unter Bank würde stattdessen vorgeschlagen. "}
              Die Prüfziffer prüft der Server.
            </>
          }
        >
          {(control) => (
            <input
              {...control}
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="DE.."
              aria-invalid={iban.trim() !== "" && !plausible}
            />
          )}
        </Field>
      </section>
    </SendPanel>
  );
}

/** Links der Inhalt, rechts Prüfen, Testen und Senden */
function SendPanel({
  data,
  ready,
  confirmTitle,
  confirmText,
  confirmFacts,
  footer,
  send,
  children,
}: {
  data: Data;
  ready: boolean;
  confirmTitle: string;
  confirmText: string;
  confirmFacts: readonly ConfirmFact[];
  footer: string;
  send: (kind: ElsterKind, pin?: string) => Promise<SendResult>;
  children: ReactNode;
}) {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useAction();
  return (
    <div className="grid-main">
      {children}
      <ElsterSubmit
        setup={data}
        title="Über ELSTER senden"
        ready={ready}
        busy={busy}
        notice={notice}
        confirmTitle={confirmTitle}
        confirmText={confirmText}
        confirmFacts={confirmFacts}
        footer={footer}
        onSubmit={(kind, pin) =>
          run(async () => {
            setNotice(elsterNotice(kind, await send(kind, pin), "An das Finanzamt gesendet."));
            await router.invalidate();
          })
        }
      />
    </div>
  );
}

/** Bescheide und Mitteilungen aus dem ELSTER-Postfach */
function Postfach({ data }: { data: Data }) {
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
