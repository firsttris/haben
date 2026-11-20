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
import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Field } from "./Field.tsx";
import { formatDateTime } from "../lib/format.ts";
import { useAction, type Notice } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { errorKind } from "./ErrorBanner.tsx";
import { mailInput } from "./mail-form-lesen.ts";
import { MailGraphFields } from "./MailGraphFields.tsx";
import { MailSmtpFields, type SmtpServer } from "./MailSmtpFields.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { removeMail, saveMail, sendMailTest, type getMailSettings } from "../server/functions/mail.ts";

type Data = Awaited<ReturnType<typeof getMailSettings>>;

const STUFEN = [14, 7, 3, 1, 0];

/** Zugang für den E-Mail-Versand (SMTP oder Microsoft 365) und Erinnerungen an Fristen per E-Mail */
export function MailCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveMail);
  const test = useServerFn(sendMailTest);
  const remove = useServerFn(removeMail);
  const s = data.settings;
  const [transport, setTransport] = useState<"smtp" | "graph">(s?.transport ?? "smtp");
  const [graphAuth, setGraphAuth] = useState<"secret" | "certificate">(s?.graphAuth ?? "certificate");
  const [server, setServer] = useState<SmtpServer>({ host: s?.host ?? "", port: String(s?.port ?? 465), secure: s?.secure ?? true });
  const [days, setDays] = useState<number[]>(s?.reminderDays ?? [7, 1]);
  const [templates, setTemplates] = useState<MailTemplates>(s?.templates ?? {});
  const action = useAction();
  const [removing, setRemoving] = useState(false);
  const { busy, notice } = action;

  const run = (work: () => Promise<Notice>) =>
    action.run(async () => {
      action.setNotice(await work());
      await router.invalidate();
    });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    void run(async () => {
      await save({ data: await mailInput(form, { transport, graphAuth, server, days, templates }) });
      if (transport === "smtp") {
        element.querySelector<HTMLInputElement>("input[name=password]")!.value = "";
      } else {
        element.querySelectorAll<HTMLInputElement>("input[name=clientSecret], input[name=certificate], input[name=privateKey]").forEach((input) => {
          input.value = "";
        });
      }
      return { tone: "ok", text: "E-Mail-Zugang gespeichert." };
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="mail-heading">
      <h2 id="mail-heading">E-Mail-Versand</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben schickt Rechnungen, Mahnungen und Erinnerungen an Fristen über deinen eigenen E-Mail-Zugang: über SMTP oder über Microsoft 365. Bei Gmail, GMX und
        web.de brauchst du für SMTP ein App-Passwort bzw. musst SMTP im Postfach freischalten. Das Passwort liegt verschlüsselt in der Datenbank.
      </p>
      <Field label="Versandweg">
        {(control) => (
          <select {...control} value={transport} onChange={(e) => setTransport(e.target.value as "smtp" | "graph")}>
            <option value="smtp">SMTP</option>
            <option value="graph">Microsoft 365 (Graph)</option>
          </select>
        )}
      </Field>
      {transport === "graph" && <MailGraphFields stored={s} auth={graphAuth} onAuthChange={setGraphAuth} />}
      {transport === "smtp" && (
        <MailSmtpFields stored={s} presets={data.presets} server={server} set={(patch) => setServer((current) => ({ ...current, ...patch }))} />
      )}
      <div className="form-row cols-2">
        <Field label="Absender">{(control) => <input {...control} name="fromAddress" type="email" defaultValue={s?.fromAddress ?? ""} required />}</Field>
        <Field label="Absendername" hint="Leer lassen für den Firmennamen">
          {(control) => <input {...control} name="fromName" defaultValue={s?.fromName ?? ""} placeholder={data.companyName || "Haben"} />}
        </Field>
      </div>
      <ReminderFields stored={s} days={days} setDays={setDays} />
      <div className="checkbox-hinted">
        <label className="checkbox">
          <input type="checkbox" name="pruefwertMail" defaultChecked={s?.pruefwertMail ?? true} aria-describedby="pruefwert-mail-hint" />
          Prüfwert des Änderungsprotokolls wöchentlich mailen
        </label>
        <span id="pruefwert-mail-hint" className="field-hint">
          Damit liegt der Stand des Audit-Logs auch außerhalb des Servers. Mit einem aufbewahrten Prüfwert lässt sich später zeigen, dass bis dahin nichts
          nachträglich verändert wurde (Einstellungen → Export).
        </span>
      </div>
      <TemplateEditor templates={templates} onChange={setTemplates} />
      <ConfirmDialog
        open={removing}
        title="E-Mail-Zugang entfernen?"
        confirmLabel="Entfernen"
        danger
        onConfirm={() =>
          void run(async () => {
            await remove();
            return { tone: "ok", text: "E-Mail-Zugang entfernt." };
          })
        }
        onClose={() => setRemoving(false)}
      >
        <p>Haben vergisst Server, Passwort, Erinnerungen und Vorlagen und kann keine E-Mails mehr senden, bis du den Zugang neu einrichtest.</p>
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
                  const result = await test();
                  return result.ok
                    ? { tone: "ok", text: `Test-Mail an ${s.reminderTo} gesendet.` }
                    : { tone: "danger", text: `Test-Mail fehlgeschlagen: ${result.error}` };
                })
              }
            >
              Test-Mail senden
            </button>
          </>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
      {data.last.length > 0 && <SentMails last={data.last} />}
    </form>
  );
}

/** Tage vor einer Frist, an denen Haben erinnert, und an welche Adresse */
function ReminderFields({ stored, days, setDays }: { stored: Data["settings"]; days: number[]; setDays: Dispatch<SetStateAction<number[]>> }) {
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
      <legend className="small" style={{ fontWeight: 500, marginBottom: 8 }}>
        Erinnern vor einer Frist
      </legend>
      <label className="checkbox">
        <input type="checkbox" name="remindersEnabled" defaultChecked={stored?.remindersEnabled ?? true} />
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
      <p className="small muted" style={{ margin: 0 }}>
        Morgens nach 7 Uhr, mehrere Fristen in einer Mail; Überfälliges einmal. Erledigte Fristen werden nicht erinnert.
      </p>
      <Field label="Erinnerungen an">
        {(control) => <input {...control} name="reminderTo" type="email" defaultValue={stored?.reminderTo ?? ""} required />}
      </Field>
    </fieldset>
  );
}

/** Die zuletzt gesendeten Mails, nicht gesendete mit der Art des Fehlers */
function SentMails({ last }: { last: Data["last"] }) {
  return (
    <ul className="small muted" style={{ margin: 0, paddingLeft: 20 }}>
      {last.map((m, i) => (
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
          Je Art und Sprache; es gilt die Sprache des Belegs. Leer lassen: Dann gilt die allgemeine Vorlage (etwa Rechnung für eine Abschlagsrechnung), sonst
          der Standardtext. Platzhalter: {"{art}"} (Rechnung, Abschlagsrechnung, Stornorechnung …), {"{nummer}"}, {"{datum}"}, {"{betrag}"}, {"{faellig}"},{" "}
          {"{zahlbar}"} („, zahlbar bis zum …“, nur bei Rechnungen), {"{kunde}"}, {"{firma}"}; bei Angeboten {"{gueltig}"}; bei Mahnungen {"{stufe}"} und{" "}
          {"{frist}"}, {"{betrag}"} ist dort der offene Gesamtbetrag. Mahnungen gibt es nur auf Deutsch.
        </p>
        <div className="chip-row" role="group" aria-label="Sprache der Vorlage">
          {(Object.keys(MAIL_LANGUAGES) as MailLanguage[]).map((l) => (
            <button key={l} type="button" className={`chip${language === l ? " active" : ""}`} aria-pressed={language === l} onClick={() => setLanguage(l)}>
              {MAIL_LANGUAGES[l]}
            </button>
          ))}
        </div>
        <Field label="Vorlage für">
          {(control) => (
            <select {...control} value={current} onChange={(e) => setKind(e.target.value as MailTemplateKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {MAIL_TEMPLATE_KINDS[k].label}
                  {custom(k) ? " · eigene Vorlage" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Betreff" hint={hint("subject")}>
          {(control) => <input {...control} value={value.subject} onChange={(e) => set("subject", e.target.value)} placeholder={fallback("subject").text} />}
        </Field>
        <Field label="Text" hint={hint("body")}>
          {(control) => <textarea {...control} value={value.body} onChange={(e) => set("body", e.target.value)} rows={6} placeholder={fallback("body").text} />}
        </Field>
      </div>
    </details>
  );
}
