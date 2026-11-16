import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction, type Notice } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { fetchInboxNow, removeInbox, saveInbox, type getInbox } from "../server/functions/inbox.ts";
import { Field } from "./Field.tsx";
import { Status, Tag, type StatusTone } from "./Status.tsx";

type Data = Awaited<ReturnType<typeof getInbox>>;
type Settings = Data["settings"];
type Abruf = Awaited<ReturnType<typeof fetchInboxNow>>;

/** Was „Jetzt abrufen“ meldet; Mails nicht freigegebener Absender bleiben ungelesen und zählen nur als Hinweis */
function abrufText(r: Abruf): string {
  const ungelesen = r.rejected ? ` ${r.rejected} ${r.rejected === 1 ? "Mail" : "Mails"} nicht freigegebener Absender ungelesen gelassen.` : "";
  if (r.messages === 0) return `Keine neuen Mails.${ungelesen}`;
  const teile = [`${r.documents} neue Belege`, r.duplicates ? `${r.duplicates} schon vorhanden` : "", r.skipped ? `${r.skipped} übersprungen` : ""];
  return `${r.messages} ${r.messages === 1 ? "Mail" : "Mails"} gelesen: ${teile.filter(Boolean).join(", ")}.${ungelesen}`;
}

/** Absenderfreigabe aus dem Textfeld: Einträge durch Komma, Semikolon oder Leerraum getrennt */
const absender = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

/** Postfach, aus dem Haben Belege abholt (IMAP), mit dem Protokoll der letzten Abrufe */
export function InboxCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveInbox);
  const fetchNow = useServerFn(fetchInboxNow);
  const remove = useServerFn(removeInbox);
  const s = data.settings;
  const [host, setHost] = useState(s?.host ?? "");
  const [port, setPort] = useState(String(s?.port ?? 993));
  const [secure, setSecure] = useState(s?.secure ?? true);
  const action = useAction();
  const [removing, setRemoving] = useState(false);
  const { busy, notice } = action;

  const run = (work: () => Promise<Notice>) =>
    action.run(async () => {
      action.setNotice(await work());
      await router.invalidate();
    });

  function preset(key: string) {
    const p = data.presets[key as keyof typeof data.presets];
    if (!p) return;
    setHost(p.host);
    setPort(String(p.port));
    setSecure(p.secure);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    void run(async () => {
      await save({
        data: {
          host,
          port: Number(port),
          secure,
          username: text("username"),
          password: text("password") || undefined,
          folder: text("folder") || "INBOX",
          outboundFolder: text("outboundFolder") || null,
          allowedSenders: absender(text("allowedSenders")),
          enabled: form.get("enabled") === "on",
        },
      });
      element.querySelector<HTMLInputElement>("input[name=password]")!.value = "";
      return { tone: "ok", text: "Postfach gespeichert." };
    });
  }

  return (
    <>
      <form className="card form-card" onSubmit={onSubmit} aria-labelledby="inbox-heading">
        <div className="form-card-head">
          <h2 id="inbox-heading">Belege per E-Mail</h2>
          <p className="small muted">Haben holt die Anhänge ungelesener Mails aus einem IMAP-Postfach (PDF, Fotos, E-Rechnungen) und legt sie als Belege ab.</p>
          {s?.lastError && <ErrorBanner title="Letzter Abruf" detail={s.lastError} />}
        </div>
        <section className="form-section" aria-labelledby="inbox-zugang">
          <h3 id="inbox-zugang">Zugang zum Postfach</h3>
          <ZugangFelder presets={data.presets} settings={s} server={{ host, setHost, port, setPort, secure, setSecure }} preset={preset} />
        </section>
        <section className="form-section" aria-labelledby="inbox-ordner">
          <h3 id="inbox-ordner">Ordner</h3>
          <OrdnerFelder settings={s} />
        </section>
        <section className="form-section" aria-labelledby="inbox-absender">
          <h3 id="inbox-absender">Absender</h3>
          <AbsenderFeld settings={s} />
        </section>
        <section className="form-section" aria-labelledby="inbox-abruf">
          <h3 id="inbox-abruf">Abruf</h3>
          <label className="checkbox">
            <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? true} />
            Stündlich abrufen
          </label>
          {s?.lastRunAt && <p className="small muted">Zuletzt abgerufen {formatDateTime(s.lastRunAt)}</p>}
          <NoticeBanner notice={notice} />
        </section>
        <ConfirmDialog
          open={removing}
          title="Postfach entfernen?"
          confirmLabel="Entfernen"
          danger
          onConfirm={() =>
            void run(async () => {
              await remove();
              return { tone: "ok", text: "Postfach entfernt." };
            })
          }
          onClose={() => setRemoving(false)}
        >
          <p>Haben ruft daraus keine Belege mehr ab und vergisst Server, Benutzername und Passwort. Schon abgelegte Belege bleiben.</p>
        </ConfirmDialog>
        <div className="actions form-footer">
          {s && (
            <>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRemoving(true)}>
                Entfernen
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => ({ tone: "ok", text: abrufText(await fetchNow()) }))}>
                Jetzt abrufen
              </button>
            </>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
      <AbgerufeneMails mails={data.last} />
    </>
  );
}

interface ServerState {
  host: string;
  setHost: (value: string) => void;
  port: string;
  setPort: (value: string) => void;
  secure: boolean;
  setSecure: (value: boolean) => void;
}

/** Anbieter, Server, Port, Verschlüsselung, Benutzername und Passwort */
function ZugangFelder({
  presets,
  settings,
  server,
  preset,
}: {
  presets: Data["presets"];
  settings: Settings;
  server: ServerState;
  preset: (key: string) => void;
}) {
  const { host, setHost, port, setPort, secure, setSecure } = server;
  return (
    <>
      <Field label="Anbieter" hint="Füllt Server, Port und Verschlüsselung aus.">
        {(control) => (
          <select {...control} defaultValue="" onChange={(e) => preset(e.target.value)}>
            <option value="">Eigener Server</option>
            {Object.entries(presets).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="form-row cols-server">
        <Field label="IMAP-Server">
          {(control) => <input {...control} name="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" required />}
        </Field>
        <Field label="Port">
          {(control) => (
            <input {...control} name="port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />
          )}
        </Field>
        <Field label="Verschlüsselung">
          {(control) => (
            <select {...control} value={secure ? "tls" : "starttls"} onChange={(e) => setSecure(e.target.value === "tls")}>
              <option value="tls">TLS (meist Port 993)</option>
              <option value="starttls">STARTTLS (meist Port 143)</option>
            </select>
          )}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Benutzername">
          {(control) => <input {...control} name="username" defaultValue={settings?.username ?? ""} autoComplete="off" required />}
        </Field>
        <Field label="Passwort" hint="Gmail, GMX und web.de: App-Passwort bzw. freigeschaltetes IMAP.">
          {(control) => (
            <input {...control} name="password" type="password" autoComplete="new-password" placeholder={settings ? "unverändert lassen" : undefined} />
          )}
        </Field>
      </div>
    </>
  );
}

/** Eingangs- und Ausgangsordner desselben Postfachs nebeneinander */
function OrdnerFelder({ settings }: { settings: Settings }) {
  return (
    <>
      <p className="small muted">Am besten eigene Ordner, in die du Rechnungen weiterleitest oder filterst.</p>
      <div className="form-row cols-2">
        <Field label="Ordner für Eingangsrechnungen" hint="Anhänge werden Belege, die Mail danach gelesen.">
          {(control) => <input {...control} name="folder" defaultValue={settings?.folder ?? "INBOX"} placeholder="INBOX" />}
        </Field>
        <Field
          label="Ordner für Ausgangsrechnungen (optional)"
          hint={
            <>
              <Tag>noch ohne Wirkung</Tag> Für Rechnungen aus Shop oder Fremdsystem. Haben liest den Ordner erst mit #660.
            </>
          }
        >
          {(control) => <input {...control} name="outboundFolder" defaultValue={settings?.outboundFolder ?? ""} placeholder="Ausgang" />}
        </Field>
      </div>
    </>
  );
}

/** Freigegebene Absender, mit den Weiterleitungen als aufklappbarer Hinweis */
function AbsenderFeld({ settings }: { settings: Settings }) {
  return (
    <>
      <Field
        label="Freigegebene Absender (optional)"
        hint="Adresse oder Domain, eine je Zeile oder durch Komma getrennt. Leer: jeder Absender. Mails anderer Absender bleiben ungelesen. Geprüft wird nur die Absenderadresse, nicht ihre Echtheit."
      >
        {(control) => (
          <textarea
            {...control}
            name="allowedSenders"
            rows={3}
            defaultValue={(settings?.allowedSenders ?? []).join("\n")}
            placeholder={"rechnung@lieferant.example\nshop.example"}
          />
        )}
      </Field>
      <details>
        <summary className="small">Bei weitergeleiteten Mails</summary>
        <p className="small muted">
          Es zählt der Absender, der im Postfach ankommt. Je nach Anbieter ist das die weiterleitende oder die ursprüngliche Adresse; im Zweifel trägst du beide
          ein.
        </p>
      </details>
    </>
  );
}

/** Wie ein protokollierter Abruf in der Liste heißt: Belege, übersprungen oder fehlgeschlagen */
function mailStatus(m: Data["last"][number]): { tone: StatusTone; text: string; detail?: string } {
  if (m.documentIds.length > 0) return { tone: "ok", text: `${m.documentIds.length} ${m.documentIds.length === 1 ? "Beleg" : "Belege"}` };
  const grund = m.skipped.join("; ");
  if (grund.startsWith("Verarbeitung fehlgeschlagen"))
    return { tone: "danger", text: "Fehlgeschlagen", detail: grund.replace(/^Verarbeitung fehlgeschlagen: /, "") };
  return { tone: "neutral", text: m.duplicates > 0 ? "Schon vorhanden" : "Übersprungen", detail: grund || undefined };
}

/** Die zuletzt abgerufenen Mails mit dem, was daraus wurde */
function AbgerufeneMails({ mails }: { mails: Data["last"] }) {
  if (mails.length === 0) return null;
  return (
    <section className="card" aria-labelledby="inbox-mails">
      <h2 id="inbox-mails">Abgerufene Mails</h2>
      <ul className="stack small" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {mails.map((m) => {
          const status = mailStatus(m);
          return (
            <li key={m.id} style={{ overflowWrap: "anywhere" }}>
              <span className="muted">{formatDateTime(m.createdAt)}</span> · {m.subject || "(ohne Betreff)"} <span className="muted">von {m.sender}</span>{" "}
              <Status tone={status.tone} inline detail={status.detail}>
                {status.text}
              </Status>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
