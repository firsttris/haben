import {
  MAIL_LANGUAGES,
  MAIL_TEMPLATE_KINDS,
  mailTemplateFallback,
  mailTemplateKey,
  type MailLanguage,
  type MailTemplateKind,
  type MailTemplates,
} from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction, type Notice } from "../lib/use-action.ts";
import { errorKind } from "./ErrorBanner.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { removeMail, saveMail, sendMailTest, type getMailSettings } from "../server/functions/mail.ts";

type Data = Awaited<ReturnType<typeof getMailSettings>>;

const STUFEN = [14, 7, 3, 1, 0];

/** SMTP-Zugang und Erinnerungen an Fristen per E-Mail */
export function MailCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveMail);
  const test = useServerFn(sendMailTest);
  const remove = useServerFn(removeMail);
  const s = data.settings;
  const [host, setHost] = useState(s?.host ?? "");
  const [port, setPort] = useState(String(s?.port ?? 465));
  const [secure, setSecure] = useState(s?.secure ?? true);
  const [days, setDays] = useState<number[]>(s?.reminderDays ?? [7, 1]);
  const [templates, setTemplates] = useState<MailTemplates>(s?.templates ?? {});
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
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    void run(async () => {
      await save({
        data: {
          host,
          port: Number(port),
          secure,
          username: text("username"),
          password: text("password") || undefined,
          fromAddress: text("fromAddress"),
          reminderTo: text("reminderTo"),
          remindersEnabled: form.get("remindersEnabled") === "on",
          reminderDays: days,
          templates,
          pruefwertMail: form.get("pruefwertMail") === "on",
        },
      });
      (event.target as HTMLFormElement).querySelector<HTMLInputElement>("input[name=password]")!.value = "";
      return { tone: "ok", text: "E-Mail-Zugang gespeichert." };
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="mail-heading">
      <h2 id="mail-heading">E-Mail-Versand</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben schickt Rechnungen, Mahnungen und Erinnerungen an Fristen über deinen eigenen E-Mail-Zugang (SMTP). Bei Gmail, GMX und web.de brauchst du dafür ein
        App-Passwort bzw. musst SMTP im Postfach freischalten. Das Passwort liegt verschlüsselt in der Datenbank.
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
          SMTP-Server
          <input name="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" required />
        </label>
        <label className="field">
          Port
          <input name="port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />
        </label>
        <label className="field">
          Verschlüsselung
          <select value={secure ? "tls" : "starttls"} onChange={(e) => setSecure(e.target.value === "tls")}>
            <option value="tls">TLS (meist Port 465)</option>
            <option value="starttls">STARTTLS (meist Port 587)</option>
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
          Absender
          <input name="fromAddress" type="email" defaultValue={s?.fromAddress ?? ""} required />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Erinnerungen an
          <input name="reminderTo" type="email" defaultValue={s?.reminderTo ?? ""} required />
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 500, marginBottom: 8 }}>
          Erinnern vor einer Frist
        </legend>
        <label className="checkbox">
          <input type="checkbox" name="remindersEnabled" defaultChecked={s?.remindersEnabled ?? true} />
          Erinnerungen an Fristen per E-Mail
        </label>
        <div className="chip-row" role="group" aria-label="Tage vorher">
          {STUFEN.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${days.includes(d) ? " active" : ""}`}
              aria-pressed={days.includes(d)}
              onClick={() => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))}
            >
              {d === 0 ? "am Tag" : `${d} Tag${d === 1 ? "" : "e"} vorher`}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          Morgens nach 7 Uhr, mehrere Fristen in einer Mail; Überfälliges einmal. Erledigte Fristen werden nicht erinnert.
        </p>
      </fieldset>
      <div>
        <label className="checkbox">
          <input type="checkbox" name="pruefwertMail" defaultChecked={s?.pruefwertMail ?? true} />
          Prüfwert des Änderungsprotokolls wöchentlich mailen
        </label>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          Damit liegt der Stand des Audit-Logs auch außerhalb des Servers. Mit einem aufbewahrten Prüfwert lässt sich später zeigen, dass bis dahin nichts
          nachträglich verändert wurde (Einstellungen → Export).
        </p>
      </div>
      <TemplateEditor templates={templates} onChange={setTemplates} />
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
                  const result = await test();
                  return result.ok
                    ? { tone: "ok", text: `Test-Mail an ${s.reminderTo} gesendet.` }
                    : { tone: "danger", text: `Test-Mail fehlgeschlagen: ${result.error}` };
                })
              }
            >
              Test-Mail senden
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await remove();
                  return { tone: "ok", text: "E-Mail-Zugang entfernt." };
                })
              }
            >
              Entfernen
            </button>
          </>
        )}
      </div>
      <NoticeBanner notice={notice} />
      {data.last.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {data.last.map((m, i) => (
            <li key={i}>
              {formatDateTime(m.createdAt)}: {m.subject}{" "}
              {m.ok ? (
                ""
              ) : (
                <span style={{ color: "var(--danger-ink)" }} title={m.error ?? ""}>
                  · nicht gesendet ({errorKind(m.error ?? "")})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Betreff und Text je Art und Sprache; leer heißt: die allgemeine Vorlage bzw. der Standardtext gilt */
function TemplateEditor({ templates, onChange }: { templates: MailTemplates; onChange: (templates: MailTemplates) => void }) {
  const [language, setLanguage] = useState<MailLanguage>("de");
  const [kind, setKind] = useState<MailTemplateKind>("rechnung");
  const kinds = (Object.keys(MAIL_TEMPLATE_KINDS) as MailTemplateKind[]).filter((k) =>
    (MAIL_TEMPLATE_KINDS[k].languages as readonly MailLanguage[]).includes(language),
  );
  const current = kinds.includes(kind) ? kind : "rechnung";
  const key = mailTemplateKey(current, language);
  const value = templates[key] ?? { subject: "", body: "" };
  const set = (field: "subject" | "body", text: string) => onChange({ ...templates, [key]: { ...value, [field]: text } });
  const fallback = (field: "subject" | "body") => mailTemplateFallback(templates, current, language, field);
  const hint = (field: "subject" | "body") => {
    const source = fallback(field).source;
    return source === "standard" ? "Leer: Standardtext" : `Leer: Vorlage ${MAIL_TEMPLATE_KINDS[source.kind].label.replace(" (allgemein)", "")}`;
  };
  const custom = (k: MailTemplateKind) => Boolean(templates[mailTemplateKey(k, language)]?.subject || templates[mailTemplateKey(k, language)]?.body);
  return (
    <details>
      <summary style={{ cursor: "pointer", fontWeight: 500 }}>Vorlagen für Rechnungen, Angebote und Mahnungen</summary>
      <div className="stack" style={{ gap: 10, marginTop: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Je Art und Sprache; es gilt die Sprache des Belegs. Leer lassen: Dann gilt die allgemeine Vorlage (etwa Rechnung für eine Abschlagsrechnung),
          sonst der Standardtext. Platzhalter: {"{art}"} (Rechnung, Abschlagsrechnung, Stornorechnung …), {"{nummer}"}, {"{datum}"}, {"{betrag}"},{" "}
          {"{faellig}"}, {"{zahlbar}"} („, zahlbar bis zum …“, nur bei Rechnungen), {"{kunde}"}, {"{firma}"}; bei Angeboten {"{gueltig}"}; bei
          Mahnungen {"{stufe}"} und {"{frist}"}, {"{betrag}"} ist dort der offene Gesamtbetrag. Mahnungen gibt es nur auf Deutsch.
        </p>
        <div className="chip-row" role="group" aria-label="Sprache der Vorlage">
          {(Object.keys(MAIL_LANGUAGES) as MailLanguage[]).map((l) => (
            <button key={l} type="button" className={`chip${language === l ? " active" : ""}`} aria-pressed={language === l} onClick={() => setLanguage(l)}>
              {MAIL_LANGUAGES[l]}
            </button>
          ))}
        </div>
        <label className="field">
          Vorlage für
          <select value={current} onChange={(e) => setKind(e.target.value as MailTemplateKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {MAIL_TEMPLATE_KINDS[k].label}
                {custom(k) ? " · eigene Vorlage" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Betreff
          <input value={value.subject} onChange={(e) => set("subject", e.target.value)} placeholder={fallback("subject").text} aria-describedby="template-subject-hint" />
          <span id="template-subject-hint" className="small muted">
            {hint("subject")}
          </span>
        </label>
        <label className="field">
          Text
          <textarea value={value.body} onChange={(e) => set("body", e.target.value)} rows={6} placeholder={fallback("body").text} aria-describedby="template-body-hint" />
          <span id="template-body-hint" className="small muted">
            {hint("body")}
          </span>
        </label>
      </div>
    </details>
  );
}
