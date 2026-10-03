import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import { getMailDraft, sendDocumentMail } from "../server/functions/invoice-mail.ts";

type Draft = Awaited<ReturnType<typeof getMailDraft>>;

/**
 * Formular zum Versand einer Rechnung oder Mahnung per E-Mail. Empfänger, Betreff und Text kommen aus der
 * Vorlage und lassen sich vor dem Senden ändern.
 */
export function SendMailForm({ kind, id, onDone }: { kind: "rechnung" | "mahnung" | "angebot"; id: string; onDone: (message: string) => void }) {
  const load = useServerFn(getMailDraft);
  const send = useServerFn(sendDocumentMail);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copyToMe, setCopyToMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    load({ data: { kind, id } })
      .then((d) => {
        if (!active) return;
        setDraft(d);
        setTo(d.to);
        setSubject(d.subject);
        setBody(d.body);
      })
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [load, kind, id]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await send({ data: { kind, id, mail: { to, subject, body, copyToMe } } });
      if (result.ok) onDone(`An ${to} gesendet.`);
      else setError(`Nicht gesendet: ${result.error}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return error ? (
      <div className="banner banner-danger" role="alert">
        {error}
      </div>
    ) : (
      <p className="small muted" style={{ margin: 0 }}>
        Lädt …
      </p>
    );
  }
  if (!draft.configured) {
    return (
      <p className="small" style={{ margin: 0 }}>
        Für den Versand fehlt noch der E-Mail-Zugang: <Link to="/einstellungen">Einstellungen › E-Mail-Versand</Link>.
      </p>
    );
  }

  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={onSubmit} aria-label={`${{ rechnung: "Rechnung", mahnung: "Mahnung", angebot: "Angebot" }[kind]} per E-Mail senden`}>
      <label className="field">
        An
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="kunde@example.com" required />
      </label>
      {!draft.to && (
        <p className="small muted" style={{ margin: "-6px 0 0" }}>
          Beim Kunden ist keine E-Mail-Adresse hinterlegt; im Kontakt eintragen, dann ist sie beim nächsten Mal vorbelegt.
        </p>
      )}
      <label className="field">
        Betreff
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </label>
      <label className="field">
        Text
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} required />
      </label>
      <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
        Anhang: {draft.attachments.join(", ")}
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={copyToMe} onChange={(e) => setCopyToMe(e.target.checked)} />
        Blindkopie an mich
      </label>
      {error && (
        <div className="banner banner-danger" role="alert" style={{ overflowWrap: "anywhere" }}>
          {error}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !to.trim()}>
          {busy ? "Sendet …" : "Jetzt senden"}
        </button>
      </div>
    </form>
  );
}
