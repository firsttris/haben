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

type Data = Awaited<ReturnType<typeof getInbox>>;

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

/** Postfach, aus dem Haben Belege abholt (IMAP) */
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
    <form className="card" onSubmit={onSubmit} aria-labelledby="inbox-heading">
      <h2 id="inbox-heading">Belege per E-Mail</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben ruft stündlich ein Postfach über IMAP ab und legt die Anhänge ungelesener Mails als Belege ab (PDF, Fotos, E-Rechnungen). Danach ist die Mail
        gelesen. Am besten ein eigener Ordner oder eine eigene Adresse, an die du Rechnungen weiterleitest. Bei Gmail, GMX und web.de brauchst du ein
        App-Passwort bzw. freigeschaltetes IMAP.
      </p>
      <Field label="Anbieter">
        {(control) => (
          <select {...control} defaultValue="" onChange={(e) => preset(e.target.value)}>
            <option value="">Eigener Server</option>
            {Object.entries(data.presets).map(([key, p]) => (
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
      <div className="form-row cols-3">
        <Field label="Benutzername">{(control) => <input {...control} name="username" defaultValue={s?.username ?? ""} autoComplete="off" required />}</Field>
        <Field label="Passwort">
          {(control) => <input {...control} name="password" type="password" autoComplete="new-password" placeholder={s ? "unverändert lassen" : undefined} />}
        </Field>
        <Field label="Ordner für Eingangsrechnungen">
          {(control) => <input {...control} name="folder" defaultValue={s?.folder ?? "INBOX"} placeholder="INBOX" />}
        </Field>
      </div>
      <InboxFilterFelder settings={s} />
      <label className="checkbox">
        <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? true} />
        Stündlich abrufen
      </label>
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
      <div className="actions" style={{ flexWrap: "wrap" }}>
        {s && (
          <>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRemoving(true)}>
              Entfernen
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await fetchNow();
                  return {
                    tone: "ok",
                    text: abrufText(r),
                  };
                })
              }
            >
              Jetzt abrufen
            </button>
          </>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
      {s?.lastRunAt && (
        <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
          Zuletzt abgerufen {formatDateTime(s.lastRunAt)}
        </p>
      )}
      {s?.lastError && <ErrorBanner title="Letzter Abruf" detail={s.lastError} />}
      {data.last.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 20 }}>
          {data.last.map((m) => (
            <li key={m.id} style={{ overflowWrap: "anywhere" }}>
              {formatDateTime(m.createdAt)}: {m.subject || "(ohne Betreff)"} von {m.sender} · {m.documentIds.length} Beleg
              {m.documentIds.length === 1 ? "" : "e"}
              {m.skipped.length ? ` · übersprungen: ${m.skipped.join("; ")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Absenderfreigabe und Ordner für Ausgangsrechnungen */
function InboxFilterFelder({ settings }: { settings: Data["settings"] }) {
  return (
    <div className="form-row cols-2">
      <Field
        label="Freigegebene Absender"
        hint="Adresse oder Domain, durch Komma oder Zeilenumbruch getrennt. Leer: jeder Absender. Mails anderer Absender bleiben ungelesen im Postfach und stehen im Protokoll. Verglichen wird nur die Absenderadresse der Mail, nicht ihre Echtheit. Bei Weiterleitungen zählt der Absender der Mail."
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
      <Field
        label="Ordner für Ausgangsrechnungen"
        hint="Für Rechnungen aus Fremdsystemen, etwa ein Shop im Bcc. Leer: aus. Haben übernimmt sie erst, wenn die Übernahme fremder Ausgangsrechnungen eingebaut ist (#660); bis dahin bleibt der Ordner unberührt."
      >
        {(control) => <input {...control} name="outboundFolder" defaultValue={settings?.outboundFolder ?? ""} placeholder="Ausgang" />}
      </Field>
    </div>
  );
}
