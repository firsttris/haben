import { desc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { MailError } from "./errors.ts";
import { loadMailSettings } from "./settings.ts";
import { transportFor } from "./transport.ts";

export { MailError } from "./errors.ts";
export {
  deleteMailSettings,
  loadMailSettings,
  mailCommonSchema,
  mailSettingsSchema,
  mailSettingsSummary,
  putMailTemplates,
  saveMailSettings,
  SMTP_PRESETS,
} from "./settings.ts";
export type { MailSettingsInput } from "./settings.ts";
export { setMailTransportForTests } from "./transport.ts";

/**
 * E-Mail: Einstellungen und Versand mit Protokoll. Erinnerungen an Fristen (finanzamt/fristen-mail.ts) und die
 * Prüfwert-Mail (auswertungen/pruefwert-mail.ts) senden hierüber. Der Versandweg (SMTP, auch Gmail mit
 * App-Passwort) steckt hinter `transport.ts`; das Passwort liegt verschlüsselt wie das ELSTER-Zertifikat in der Datenbank.
 */

export const MAIL_ACTOR = "system:mail";

export interface Message {
  kind: "test" | "fristen" | "rechnung" | "mahnung" | "angebot" | "pruefwert";
  /** ein oder mehrere Empfänger, durch Komma getrennt */
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string; contentType: string }[];
  reminderKeys?: string[];
  invoiceId?: string;
  dunningId?: string;
  quoteId?: string;
}

/** Name im Absender: der eingetragene, sonst der Firmenname, damit Kunden nicht „Haben“ als Absender sehen */
export function senderName(fromName: string, companyName: string): string {
  return fromName.trim() || companyName.trim() || "Haben";
}

/** Sendet und protokolliert; Fehler des Servers kommen als Ergebnis zurück, nicht als Ausnahme */
export async function send(actor: string, message: Message): Promise<{ ok: boolean; error: string | null }> {
  const settings = await loadMailSettings();
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet.");
  // Nur lesen: loadCompany legt die Zeile an und schriebe so beim Versand ins Änderungsprotokoll
  const [company] = await db.select({ name: schema.company.name }).from(schema.company).where(eq(schema.company.id, 1));
  let error: string | null = null;
  try {
    await transportFor(settings).sendMail({
      from: { name: senderName(settings.fromName, company?.name ?? ""), address: settings.fromAddress },
      to: message.to,
      ...(message.bcc ? { bcc: message.bcc } : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.attachments ? { attachments: message.attachments } : {}),
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await withActor(actor, (tx) =>
    tx.insert(schema.mailLog).values({
      kind: message.kind,
      transport: settings.transport,
      recipient: message.to,
      subject: message.subject,
      ok: error === null,
      error,
      reminderKeys: error === null ? (message.reminderKeys ?? []) : [],
      bcc: message.bcc ?? null,
      invoiceId: message.invoiceId ?? null,
      dunningId: message.dunningId ?? null,
      quoteId: message.quoteId ?? null,
      attachments: (message.attachments ?? []).map((a) => a.filename),
    }),
  );
  return { ok: error === null, error };
}

export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const baseUrl = () => env().BETTER_AUTH_URL.replace(/\/$/, "");

export async function sendTestMail(actor: string) {
  const settings = await loadMailSettings();
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet.");
  const text = `Diese Test-Mail kommt von Haben (${baseUrl()}). Der E-Mail-Zugang funktioniert.`;
  return send(actor, { kind: "test", to: settings.reminderTo, subject: "Haben: Test-Mail", text, html: `<p>${escapeHtml(text)}</p>` });
}

/** Stunde in Berlin, damit Erinnerungen nicht nachts kommen */
export const berlinHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" }).formatToParts(now).find((p) => p.type === "hour")!.value,
  );

export async function lastMails(limit = 5) {
  return db
    .select({
      kind: schema.mailLog.kind,
      subject: schema.mailLog.subject,
      ok: schema.mailLog.ok,
      error: schema.mailLog.error,
      createdAt: schema.mailLog.createdAt,
    })
    .from(schema.mailLog)
    .orderBy(desc(schema.mailLog.createdAt))
    .limit(limit);
}
