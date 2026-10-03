import { tageBis } from "@haben/core";
import { desc, eq } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { decrypt, encrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";
import { listFristen, type Frist } from "./fristen.ts";

/**
 * E-Mail über SMTP: jeder Anbieter mit SMTP-Zugang, auch Gmail (smtp.gmail.com mit App-Passwort).
 * Das Passwort liegt verschlüsselt wie das ELSTER-Zertifikat in der Datenbank.
 */

export class MailError extends Error {}

export const MAIL_ACTOR = "system:mail";

/** Bekannte Anbieter zum Vorbelegen; Gmail und GMX brauchen ein App-Passwort bzw. freigeschaltetes SMTP */
export const SMTP_PRESETS = {
  gmail: { label: "Gmail", host: "smtp.gmail.com", port: 465, secure: true },
  gmx: { label: "GMX", host: "mail.gmx.net", port: 465, secure: true },
  webde: { label: "web.de", host: "smtp.web.de", port: 587, secure: false },
  posteo: { label: "Posteo", host: "posteo.de", port: 465, secure: true },
  mailbox: { label: "mailbox.org", host: "smtp.mailbox.org", port: 465, secure: true },
} as const;

const email = z.string().trim().email("Keine gültige E-Mail-Adresse");

export const mailSettingsSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1, "Server fehlt")
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/, "Nur der Servername, z. B. smtp.gmail.com"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1, "Benutzername fehlt").max(320),
  /** leer: das gespeicherte Passwort behalten */
  password: z.string().max(500).optional(),
  fromAddress: email,
  reminderTo: email,
  remindersEnabled: z.boolean(),
  reminderDays: z.array(z.number().int().min(0).max(60)).max(5),
  invoiceSubject: z.string().trim().max(300).default(""),
  invoiceBody: z.string().trim().max(5000).default(""),
  dunningSubject: z.string().trim().max(300).default(""),
  dunningBody: z.string().trim().max(5000).default(""),
});

export type MailSettingsInput = z.input<typeof mailSettingsSchema>;

export async function loadMailSettings() {
  const [row] = await db.select().from(schema.mailSettings).where(eq(schema.mailSettings.id, 1));
  return row ?? null;
}

/** Was die Oberfläche sehen darf: alles außer dem Passwort */
export async function mailSettingsSummary() {
  const row = await loadMailSettings();
  if (!row) return null;
  const { ciphertext: _ciphertext, ...rest } = row;
  return { ...rest, reminderDays: [...rest.reminderDays].sort((a, b) => b - a) };
}

export async function saveMailSettings(actor: string, input: MailSettingsInput): Promise<void> {
  const data = mailSettingsSchema.parse(input);
  const existing = await loadMailSettings();
  if (!data.password && !existing) throw new MailError("Das Passwort fehlt.");
  const { password, ...rest } = data;
  const values = {
    ...rest,
    reminderDays: [...new Set(data.reminderDays)].sort((a, b) => b - a),
    ciphertext: password ? encrypt(new TextEncoder().encode(password)) : existing!.ciphertext,
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.mailSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.mailSettings.id, set: values }),
  );
}

export async function deleteMailSettings(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.mailSettings).where(eq(schema.mailSettings.id, 1)));
}

/** Austauschbar für Tests */
let transportFactory = (settings: NonNullable<Awaited<ReturnType<typeof loadMailSettings>>>): Transporter =>
  nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.username, pass: new TextDecoder().decode(decrypt(settings.ciphertext)) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

export function setMailTransportForTests(factory: typeof transportFactory): void {
  transportFactory = factory;
}

export interface Message {
  kind: "test" | "fristen" | "rechnung" | "mahnung";
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
}

/** Sendet und protokolliert; Fehler des Servers kommen als Ergebnis zurück, nicht als Ausnahme */
export async function send(actor: string, message: Message): Promise<{ ok: boolean; error: string | null }> {
  const settings = await loadMailSettings();
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet.");
  let error: string | null = null;
  try {
    await transportFactory(settings).sendMail({
      from: { name: "Haben", address: settings.fromAddress },
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
      recipient: message.to,
      subject: message.subject,
      ok: error === null,
      error,
      reminderKeys: error === null ? (message.reminderKeys ?? []) : [],
      bcc: message.bcc ?? null,
      invoiceId: message.invoiceId ?? null,
      dunningId: message.dunningId ?? null,
      attachments: (message.attachments ?? []).map((a) => a.filename),
    }),
  );
  return { ok: error === null, error };
}

export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const baseUrl = () => env().BETTER_AUTH_URL.replace(/\/$/, "");

export async function sendTestMail(actor: string) {
  const settings = await loadMailSettings();
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet.");
  const text = `Diese Test-Mail kommt von Haben (${baseUrl()}). Der E-Mail-Zugang funktioniert.`;
  return send(actor, { kind: "test", to: settings.reminderTo, subject: "Haben: Test-Mail", text, html: `<p>${escapeHtml(text)}</p>` });
}

function datum(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function wann(tage: number): string {
  if (tage < 0) return `seit ${-tage} Tag${tage === -1 ? "" : "en"} überfällig`;
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  return `in ${tage} Tagen`;
}

/** Inhalt einer Erinnerung; neu: was heute erinnert wird, offen: alles Überfällige als Hinweis dazu */
export function fristenMail(neu: { frist: Frist; tage: number }[], today: string) {
  const subject =
    neu.length === 1 ? `Frist ${wann(neu[0]!.tage)}: ${neu[0]!.frist.titel}` : `${neu.length} Steuerfristen stehen an`;
  const zeilen = neu.map(({ frist, tage }) => ({ frist, text: `${datum(frist.datum)} (${wann(tage)}): ${frist.titel}` }));
  const text = [
    `Erinnerung von Haben, Stand ${datum(today)}:`,
    "",
    ...zeilen.map(({ frist, text }) => `- ${text}\n  ${frist.detail}\n  ${baseUrl()}${frist.link}`),
    "",
    `Alle Fristen: ${baseUrl()}/fristen`,
  ].join("\n");
  const html = [
    `<p>Erinnerung von Haben, Stand ${datum(today)}:</p>`,
    "<ul>",
    ...zeilen.map(
      ({ frist, text }) =>
        `<li><a href="${escapeHtml(baseUrl() + frist.link)}">${escapeHtml(text)}</a><br><small>${escapeHtml(frist.detail)}</small></li>`,
    ),
    "</ul>",
    `<p><a href="${escapeHtml(`${baseUrl()}/fristen`)}">Alle Fristen in Haben</a></p>`,
  ].join("\n");
  return { subject, text, html };
}

/** Schlüssel, zu denen schon erfolgreich erinnert wurde */
async function sentReminderKeys(): Promise<Set<string>> {
  const rows = await db.select({ keys: schema.mailLog.reminderKeys }).from(schema.mailLog).where(eq(schema.mailLog.ok, true));
  return new Set(rows.flatMap((r) => r.keys));
}

/** Stunde in Berlin, damit Erinnerungen nicht nachts kommen */
const berlinHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" })
      .formatToParts(now)
      .find((p) => p.type === "hour")!.value,
  );

/**
 * Für den Scheduler: Erinnert an offene Fristen, die heute genau eine der eingestellten Tageszahlen entfernt
 * sind, und an überfällige einmal. Jede Frist und Stufe nur einmal; mehrere Fristen in einer Mail.
 * Verpasste Stufen (Server war aus) holt der nächste Lauf nach, solange die Frist noch nicht vorbei ist.
 */
export async function runDueFristenMails(today: string, now = new Date()) {
  const settings = await loadMailSettings();
  if (!settings?.remindersEnabled || berlinHour(now) < 7) return null;
  const stufen = [...settings.reminderDays].sort((a, b) => b - a);
  const [fristen, sent] = await Promise.all([listFristen(today), sentReminderKeys()]);
  const neu: { frist: Frist; tage: number; key: string }[] = [];
  for (const frist of fristen) {
    if (frist.status === "erledigt") continue;
    const tage = tageBis(frist.datum, today);
    if (tage < 0) {
      // Überfällig: einmal erinnern, außer bei Zahlungshinweisen und abgelaufenen Einspruchsfristen
      const key = `${frist.id}:ueberfaellig`;
      if (frist.status === "offen" && frist.art !== "einspruch" && !sent.has(key)) neu.push({ frist, tage, key });
      continue;
    }
    // Die engste Stufe, die schon erreicht ist; frühere, noch nicht gesendete Stufen entfallen
    const stufe = stufen.filter((s) => tage <= s).at(-1);
    if (stufe === undefined) continue;
    const key = `${frist.id}:${stufe}`;
    if (!sent.has(key)) neu.push({ frist, tage, key });
  }
  if (neu.length === 0) return { sent: 0 };
  const mail = fristenMail(neu, today);
  const result = await send(MAIL_ACTOR, { kind: "fristen", to: settings.reminderTo, ...mail, reminderKeys: neu.map((n) => n.key) });
  if (!result.ok) throw new MailError(`Erinnerung nicht gesendet: ${result.error}`);
  return { sent: neu.length };
}

export async function lastMails(limit = 5) {
  return db
    .select({ kind: schema.mailLog.kind, subject: schema.mailLog.subject, ok: schema.mailLog.ok, error: schema.mailLog.error, createdAt: schema.mailLog.createdAt })
    .from(schema.mailLog)
    .orderBy(desc(schema.mailLog.createdAt))
    .limit(limit);
}
