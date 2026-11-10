import type { schema } from "../../db/index.ts";
import { graphTransport } from "./transport-graph.ts";
import { smtpTransport } from "./transport-smtp.ts";

/**
 * Versandwege für E-Mails. `send()` in `mail.ts` bleibt der einzige Einstieg und protokolliert jeden Versuch; ein Weg
 * liefert nur den Transport. Die Form von `OutgoingMail` entspricht den Optionen von nodemailer, damit der SMTP-Weg
 * unverändert bleibt.
 */

export type MailSettingsRow = typeof schema.mailSettings.$inferSelect;

export interface OutgoingMail {
  from: { name: string; address: string };
  /** eine oder mehrere Adressen, durch Komma getrennt */
  to: string;
  bcc?: string;
  /** Antwortadresse; heute setzt kein Aufrufer sie */
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string; contentType: string }[];
}

export interface MailTransport {
  /** Wirft bei jedem Fehler; `send()` macht daraus ein Ergebnis fürs Protokoll */
  sendMail(mail: OutgoingMail): Promise<unknown>;
}

export type MailTransportKind = MailSettingsRow["transport"];

/** Austauschbar für Tests */
let transportFactory = (settings: MailSettingsRow): MailTransport => (settings.transport === "graph" ? graphTransport(settings) : smtpTransport(settings));

export function setMailTransportForTests(factory: typeof transportFactory): void {
  transportFactory = factory;
}

/** Der Transport für die gespeicherten Einstellungen */
export function transportFor(settings: MailSettingsRow): MailTransport {
  return transportFactory(settings);
}
