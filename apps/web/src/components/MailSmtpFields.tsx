import type { getMailSettings } from "../server/functions/mail.ts";
import { Field } from "./Field.tsx";

type Data = Awaited<ReturnType<typeof getMailSettings>>;

/** Server, Port und Verschlüsselung; der Port bleibt Text, solange er im Feld steht */
export type SmtpServer = { host: string; port: string; secure: boolean };

/** Felder für den Versand über SMTP: Anbieter als Vorlage, Server und Anmeldung */
export function MailSmtpFields({
  stored,
  presets,
  server,
  set,
}: {
  stored: Data["settings"];
  presets: Data["presets"];
  server: SmtpServer;
  set: (patch: Partial<SmtpServer>) => void;
}) {
  function preset(key: string) {
    const p = presets[key as keyof typeof presets];
    if (!p) return;
    set({ host: p.host, port: String(p.port), secure: p.secure });
  }

  return (
    <>
      <Field label="Anbieter">
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
        <Field label="SMTP-Server">
          {(control) => (
            <input {...control} name="host" value={server.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.gmail.com" required />
          )}
        </Field>
        <Field label="Port">
          {(control) => (
            <input
              {...control}
              name="port"
              value={server.port}
              onChange={(e) => set({ port: e.target.value.replace(/\D/g, "") })}
              inputMode="numeric"
              required
            />
          )}
        </Field>
        <Field label="Verschlüsselung">
          {(control) => (
            <select {...control} value={server.secure ? "tls" : "starttls"} onChange={(e) => set({ secure: e.target.value === "tls" })}>
              <option value="tls">TLS (meist Port 465)</option>
              <option value="starttls">STARTTLS (meist Port 587)</option>
            </select>
          )}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Benutzername">
          {(control) => <input {...control} name="username" defaultValue={stored?.username ?? ""} autoComplete="off" required />}
        </Field>
        <Field label="Passwort">
          {(control) => (
            <input
              {...control}
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={stored?.transport === "smtp" ? "unverändert lassen" : undefined}
            />
          )}
        </Field>
      </div>
    </>
  );
}
