import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { ElsterSubmit } from "../../components/ElsterSubmit.tsx";
import { elsterNotice, finanzamtFakten, type ElsterKind } from "../../lib/elster.ts";
import type { ConfirmFact } from "../../components/ConfirmDialog.tsx";
import { PURPOSE_SHORT } from "../../lib/kontozweck.ts";
import { useAction } from "../../lib/use-action.ts";
import { sendFinanzamtBankChange, sendFinanzamtMessage } from "../../server/functions/finanzamt.ts";
import { Field } from "../../components/Field.tsx";
import { type Data, type SendResult, TOPIC_LABEL, type Topic } from "./-finanzamt-daten.ts";

export function MessageForm({
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

export function BankChangeForm({ data }: { data: Data }) {
  const send = useServerFn(sendFinanzamtBankChange);
  // Vorbelegung: das Konto mit dem Zweck "steuer", sonst die IBAN aus den Firmendaten.
  const vorbelegt = data.taxAccount?.iban ?? data.company.iban ?? "";
  // Welches gepflegte Konto ist vorbelegt? Vergleich ohne Leerzeichen und Gross-/Kleinschreibung,
  // weil dieselbe IBAN in beiden Quellen unterschiedlich geschrieben sein kann.
  const gleich = (a: string, b: string) => a.replace(/\s+/g, "").toUpperCase() === b.replace(/\s+/g, "").toUpperCase();
  const [gewaehlt, setGewaehlt] = useState<string>(() => data.konten.find((k) => gleich(k.iban, vorbelegt))?.id ?? "");
  const [frei, setFrei] = useState<string>(vorbelegt);
  // Ein Konto aus der Liste hat Vorrang; das freie Feld gilt nur, wenn keines gewaehlt ist.
  const iban = gewaehlt ? (data.konten.find((k) => k.id === gewaehlt)?.iban ?? frei) : frei;
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  const plausible = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact);
  const ready = data.bankIssues.length === 0 && plausible;
  const gewaehltesKonto = data.konten.find((k) => k.id === gewaehlt) ?? null;

  return (
    <SendPanel
      data={data}
      ready={ready}
      confirmTitle="Bankverbindung an das Finanzamt senden?"
      confirmText="Das Finanzamt nutzt danach dieses Konto für alle Steuerarten."
      confirmFacts={[
        ...finanzamtFakten(data.company.finanzamt, data.company.steuernummer),
        ...(data.person ? [{ label: "Kontoinhaber", value: `${data.person.vorname} ${data.person.name}` }] : []),
        ...(gewaehltesKonto
          ? [
              {
                label: "Konto",
                value: `${gewaehltesKonto.name} (${PURPOSE_SHORT[gewaehltesKonto.zweck]})`,
              },
            ]
          : []),
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
        {data.konten.length > 0 && (
          <Field
            label="Konto"
            hint={
              <>
                Aus deinen gepflegten Konten mit Name und Zweck. Das Finanzamt nutzt das Konto für alle Steuerarten, also auch für Erstattungen. Ein Konto mit
                dem Zweck „Steuerkonto“ ist vorbelegt.
              </>
            }
          >
            {(control) => (
              <select
                {...control}
                value={gewaehlt}
                onChange={(e) => {
                  const id = e.target.value;
                  setGewaehlt(id);
                  // Beim Zurueckschalten auf "anderes Konto" bleibt der zuletzt getippte Wert stehen.
                  if (id) setFrei(data.konten.find((k) => k.id === id)?.iban ?? frei);
                }}
              >
                <option value="">Anderes Konto (IBAN eintippen)</option>
                {data.konten.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                    {` · ${PURPOSE_SHORT[k.zweck]}`}
                    {` · ${k.iban.replace(/(.{4})/g, "$1 ").trim()}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {/* Freies Feld nur, wenn kein gepflegtes Konto gewaehlt ist: dann gibt es nichts zu tippen,
            und die angezeigte IBAN ist garantiert die des gewaehlten Kontos. */}
        {!gewaehltesKonto && (
          <Field
            label="IBAN"
            hint={
              <>
                {data.konten.length > 0
                  ? "Kein gepflegtes Konto passt? IBAN eintippen oder unter Bank ein Konto anlegen. "
                  : "Noch kein Konto unter Bank gepflegt; die IBAN steht in den Firmendaten. "}
                Die Prüfziffer prüft der Server.
              </>
            }
          >
            {(control) => (
              <input
                {...control}
                value={frei}
                onChange={(e) => setFrei(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="DE.."
                aria-invalid={frei.trim() !== "" && !plausible}
              />
            )}
          </Field>
        )}
      </section>
    </SendPanel>
  );
}

/** Links der Inhalt, rechts Prüfen, Testen und Senden */
export function SendPanel({
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
