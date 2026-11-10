import nodemailer from "nodemailer";
import { decrypt } from "../../crypto.ts";
import { MailError } from "./errors.ts";
import type { MailSettingsRow, MailTransport } from "./transport.ts";

/** SMTP: jeder Anbieter mit SMTP-Zugang. Das Passwort liegt verschlüsselt in `mail_settings.ciphertext`. */
export function smtpTransport(settings: MailSettingsRow): MailTransport {
  const { host, port, secure, username, ciphertext } = settings;
  // Die Tabelle erzwingt das für `smtp` (CHECK mail_settings_transport); die Prüfung ist für die Typen
  if (host === null || port === null || secure === null || username === null || ciphertext === null) throw new MailError("Der SMTP-Zugang ist unvollständig.");
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: username, pass: new TextDecoder().decode(decrypt(ciphertext)) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}
