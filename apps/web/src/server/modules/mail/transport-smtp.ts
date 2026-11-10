import nodemailer from "nodemailer";
import { decrypt } from "../../crypto.ts";
import type { MailSettingsRow, MailTransport } from "./transport.ts";

/** SMTP: jeder Anbieter mit SMTP-Zugang. Das Passwort liegt verschlüsselt in `mail_settings.ciphertext`. */
export function smtpTransport(settings: MailSettingsRow): MailTransport {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.username, pass: new TextDecoder().decode(decrypt(settings.ciphertext)) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}
