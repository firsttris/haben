import { MailError } from "../errors.ts";

/** Fehlerkörper von Graph: `{ "error": { "code": "...", "message": "..." } }` */
function errorBody(text: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    return {
      ...(typeof parsed.error?.code === "string" ? { code: parsed.error.code } : {}),
      ...(typeof parsed.error?.message === "string" ? { message: parsed.error.message } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Deutsche Meldung zu einer Antwort von Graph. Die Zuordnung folgt dem HTTP-Status; die Fehlercodes von Exchange für
 * „Postfach nicht erlaubt“ und „Absender unbekannt“ sind nicht gegen einen echten Tenant geprüft. Code und Anfrage-ID
 * stehen dahinter, damit der Microsoft-Support die Anfrage findet.
 */
export function graphError(status: number, text: string, mailbox: string, requestId: string | null): MailError {
  const { code, message } = errorBody(text);
  const detail = [code, message?.slice(0, 200)].filter(Boolean).join(": ");
  let reason: string;
  if (status === 400) reason = "Microsoft 365 hat die Mail abgelehnt (Empfänger oder Inhalt ungültig).";
  else if (status === 401) reason = "Die Anmeldung der App bei Microsoft 365 wurde abgelehnt. Prüfe Tenant, Client-ID und Secret bzw. Zertifikat.";
  else if (status === 403)
    reason = `Die App darf nicht aus dem Postfach ${mailbox} senden. Prüfe die Berechtigung Mail.Send (Application) und ob das Postfach für die App erlaubt ist. Änderungen an der Berechtigung wirken erst nach bis zu 2 Stunden.`;
  else if (status === 404) reason = `Das Postfach ${mailbox} gibt es nicht oder die App sieht es nicht. Prüfe die Absenderadresse und das Feld Postfach.`;
  else if (status === 413) reason = "Die Mail ist für Microsoft 365 zu groß. Verkleinere die Anhänge oder verwende SMTP.";
  else if (status === 429) reason = "Microsoft 365 ist überlastet (zu viele Anfragen). Bitte später erneut versuchen.";
  else if (status >= 500) reason = `Microsoft 365 ist gerade nicht erreichbar (HTTP ${status}). Bitte später erneut versuchen.`;
  else reason = `Microsoft 365 hat den Versand abgelehnt (HTTP ${status}).`;
  const info = [detail, requestId ? `Anfrage-ID ${requestId}` : ""].filter(Boolean).join(", ");
  return new MailError(info ? `${reason} (${info})` : reason);
}
