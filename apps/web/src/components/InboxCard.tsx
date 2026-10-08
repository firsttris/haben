import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction, type Notice } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { fetchInboxNow, removeInbox, saveInbox, type getInbox } from "../server/functions/inbox.ts";

type Data = Awaited<ReturnType<typeof getInbox>>;

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
        Haben ruft stündlich ein Postfach über IMAP ab und legt die Anhänge ungelesener Mails als Belege ab (PDF, Fotos, E-Rechnungen).
        Danach ist die Mail gelesen. Am besten ein eigener Ordner oder eine eigene Adresse, an die du Rechnungen weiterleitest. Bei Gmail,
        GMX und web.de brauchst du ein App-Passwort bzw. freigeschaltetes IMAP.
      </p>
      <label className="field">
        Anbieter
        <select defaultValue="" onChange={(e) => preset(e.target.value)}>
          <option value="">Eigener Server</option>
          {Object.entries(data.presets).map(([key, p]) => (
            <option key={key} value={key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label className="field">
          IMAP-Server
          <input name="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" required />
        </label>
        <label className="field">
          Port
          <input name="port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />
        </label>
        <label className="field">
          Verschlüsselung
          <select value={secure ? "tls" : "starttls"} onChange={(e) => setSecure(e.target.value === "tls")}>
            <option value="tls">TLS (meist Port 993)</option>
            <option value="starttls">STARTTLS (meist Port 143)</option>
          </select>
        </label>
        <label className="field">
          Benutzername
          <input name="username" defaultValue={s?.username ?? ""} autoComplete="off" required />
        </label>
        <label className="field">
          Passwort
          <input name="password" type="password" autoComplete="new-password" placeholder={s ? "unverändert lassen" : undefined} />
        </label>
        <label className="field">
          Ordner
          <input name="folder" defaultValue={s?.folder ?? "INBOX"} placeholder="INBOX" />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? true} />
        Stündlich abrufen
      </label>
      <div className="actions" style={{ flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
        {s && (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await fetchNow();
                  return {
                    tone: "ok",
                    text:
                      r.messages === 0
                        ? "Keine neuen Mails."
                        : `${r.messages} ${r.messages === 1 ? "Mail" : "Mails"} gelesen: ${r.documents} neue Belege${r.duplicates ? `, ${r.duplicates} schon vorhanden` : ""}${r.skipped ? `, ${r.skipped} übersprungen` : ""}.`,
                  };
                })
              }
            >
              Jetzt abrufen
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(async () => (await remove(), { tone: "ok", text: "Postfach entfernt." }))}>
              Entfernen
            </button>
          </>
        )}
      </div>
      <NoticeBanner notice={notice} />
      {s?.lastRunAt && (
        <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
          Zuletzt abgerufen {formatDateTime(s.lastRunAt)}
          {s.lastError ? ` · Fehler: ${s.lastError}` : ""}
        </p>
      )}
      {data.last.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {data.last.map((m) => (
            <li key={m.id} style={{ overflowWrap: "anywhere" }}>
              {formatDateTime(m.createdAt)}: {m.subject || "(ohne Betreff)"} von {m.sender} · {m.documentIds.length} Beleg{m.documentIds.length === 1 ? "" : "e"}
              {m.skipped.length ? ` · übersprungen: ${m.skipped.join("; ")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
