import { UserError } from "./errors.ts";
import { tageBis } from "@haben/core";
import { and, desc, eq, sql } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { decrypt, encrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";
import { listFristen, type Frist } from "./fristen.ts";
import { chainHead, checkIntegrity, formatPruefwert } from "./integrity.ts";

/**
 * E-Mail über SMTP: jeder Anbieter mit SMTP-Zugang, auch Gmail (smtp.gmail.com mit App-Passwort).
 * Das Passwort liegt verschlüsselt wie das ELSTER-Zertifikat in der Datenbank.
 */

export class MailError extends UserError {}

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
  pruefwertMail: z.boolean().default(true),
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
      quoteId: message.quoteId ?? null,
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
function fristenMail(neu: { frist: Frist; tage: number }[], today: string) {
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
  const rows = await db
    .select({ keys: schema.mailLog.reminderKeys })
    .from(schema.mailLog)
    .where(and(eq(schema.mailLog.kind, "fristen"), eq(schema.mailLog.ok, true)));
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

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Ob das Audit-Log seit Eintrag seq mehr enthält als die Protokollzeilen der Prüfwert-Mails selbst */
async function changedSince(seq: number): Promise<boolean> {
  const [row] = await db
    .select({ seq: schema.auditLog.seq })
    .from(schema.auditLog)
    .where(
      sql`${schema.auditLog.seq} > ${seq} and not (${schema.auditLog.tableName} = 'mail_log' and ${schema.auditLog.newValue} ->> 'kind' = 'pruefwert')`,
    )
    .limit(1);
  return row !== undefined;
}

/** Hash des Eintrags seq, null wenn es ihn nicht gibt */
async function rowHashAt(seq: number): Promise<string | null> {
  const [row] = await db.select({ hash: schema.auditLog.rowHash }).from(schema.auditLog).where(eq(schema.auditLog.seq, seq));
  return row ? row.hash.toString("hex") : null;
}

/** Prüfungen ohne Anlass für eine Mail höchstens einmal am Tag; im Prozess gemerkt */
let quietCheckAt = 0;

/**
 * Für den Scheduler: Schickt den Prüfwert des Audit-Logs (Kopf der Hash-Kette) einmal pro Woche an die Adresse
 * für Erinnerungen, damit er außerhalb des Servers liegt. Vorher prüft sie Kette und Siegel und vergleicht den
 * Prüfwert der letzten Mail mit dem Eintrag dieser Nummer. Gesendet wird, wenn sich etwas geändert hat oder die
 * Prüfung etwas findet; auch Manipulationen ohne neuen Eintrag fallen so auf. Ohne Anlass wird höchstens einmal am
 * Tag geprüft, nach einem Fehlschlag frühestens am nächsten Tag wieder gesendet.
 */
export async function runDuePruefwertMail(now = new Date()) {
  const settings = await loadMailSettings();
  if (!settings?.pruefwertMail || berlinHour(now) < 7) return null;
  const [lastOk] = await db
    .select({ createdAt: schema.mailLog.createdAt, keys: schema.mailLog.reminderKeys })
    .from(schema.mailLog)
    .where(and(eq(schema.mailLog.kind, "pruefwert"), eq(schema.mailLog.ok, true)))
    .orderBy(desc(schema.mailLog.createdAt))
    .limit(1);
  if (lastOk && now.getTime() - lastOk.createdAt.getTime() < WEEK) return null;
  const [lastTry] = await db
    .select({ createdAt: schema.mailLog.createdAt })
    .from(schema.mailLog)
    .where(and(eq(schema.mailLog.kind, "pruefwert"), eq(schema.mailLog.ok, false)))
    .orderBy(desc(schema.mailLog.createdAt))
    .limit(1);
  if (lastTry && now.getTime() - lastTry.createdAt.getTime() < DAY) return null;
  if (now.getTime() - quietCheckAt < DAY) return null;
  const head = await chainHead();
  if (!head) return null;

  // Prüfwert der letzten Mail: Nummer und Hash
  const [lastSeqKey, lastHash] = lastOk?.keys ?? [];
  const lastSeq = Number(lastSeqKey);
  const known = lastOk !== undefined && Number.isInteger(lastSeq);
  const changed = !known || (await changedSince(lastSeq));
  const lastNow = known ? await rowHashAt(lastSeq) : null;
  const rewritten = known && lastHash !== undefined && lastNow !== lastHash;
  const report = await checkIntegrity();
  if (!changed && !rewritten && report.problems.length === 0 && report.abgleich.abweichungen.length === 0) {
    quietCheckAt = now.getTime();
    return null;
  }

  const pruefwert = formatPruefwert(head);
  const stand = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(now);
  const findings = [
    ...(rewritten
      ? [
          lastNow === null
            ? `Eintrag Nr. ${lastSeq} aus der letzten Mail fehlt im Protokoll: Einträge wurden gelöscht oder ein älteres Backup eingespielt.`
            : `Eintrag Nr. ${lastSeq} aus der letzten Mail hat jetzt einen anderen Hash (${lastNow} statt ${lastHash}): Das Protokoll wurde nachträglich verändert und neu verkettet.`,
        ]
      : []),
    ...(report.problems.length > 0
      ? [`Prüfung von Kette und Siegel: ${report.problems.length}${report.truncated ? " oder mehr" : ""} Befunde. Die Datenbank wurde außerhalb von Haben verändert.`]
      : []),
    ...(report.abgleich.abweichungen.length > 0
      ? [
          `Abgleich von Journal und Steuerwerten: ${report.abgleich.abweichungen.length} ${report.abgleich.abweichungen.length === 1 ? "Abweichung" : "Abweichungen"} (${report.abgleich.abweichungen
            .slice(0, 3)
            .map((a) => `${a.zeitraum} ${a.posten}`)
            .join("; ")}${report.abgleich.abweichungen.length > 3 ? " …" : ""}).`,
        ]
      : []),
  ];
  const befund =
    findings.length === 0
      ? `Prüfung von Kette und Siegel: unverändert (${report.entries} Einträge, ${report.seals} Siegel).`
      : `${findings.join(" ")} Einzelheiten unter ${baseUrl()}/einstellungen?bereich=export`;
  const intro = `Prüfwert des Änderungsprotokolls von Haben (${baseUrl()}), Stand ${stand}:`;
  const aufbewahren =
    "Bitte diese Mail aufbewahren, nicht nur auf dem Server von Haben. Mit dem Prüfwert lässt sich später zeigen, dass das Änderungsprotokoll und die festgeschriebenen Daten bis zu diesem Stand nicht nachträglich verändert wurden: in Haben unter Einstellungen → Export → Änderungsprotokoll prüfen einfügen und vergleichen.";
  const hinweis = "Diese Mail kommt höchstens einmal pro Woche, wenn sich etwas geändert hat oder die Prüfung etwas findet. Abschalten in den E-Mail-Einstellungen.";
  const text = [intro, "", pruefwert, "", befund, "", aufbewahren, "", hinweis].join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p><code>${escapeHtml(pruefwert)}</code></p>`,
    `<p>${escapeHtml(befund)}</p>`,
    `<p>${escapeHtml(aufbewahren)}</p>`,
    `<p><small>${escapeHtml(hinweis)}</small></p>`,
  ].join("\n");
  const subject =
    findings.length === 0 ? `Haben: Prüfwert des Änderungsprotokolls (Nr. ${head.seq})` : `Haben: Änderungsprotokoll mit Befunden (Nr. ${head.seq})`;
  const result = await send(MAIL_ACTOR, { kind: "pruefwert", to: settings.reminderTo, subject, text, html, reminderKeys: [String(head.seq), head.hash] });
  if (!result.ok) throw new MailError(`Prüfwert nicht gesendet: ${result.error}`);
  return { seq: head.seq, problems: report.problems.length, rewritten };
}

export async function lastMails(limit = 5) {
  return db
    .select({ kind: schema.mailLog.kind, subject: schema.mailLog.subject, ok: schema.mailLog.ok, error: schema.mailLog.error, createdAt: schema.mailLog.createdAt })
    .from(schema.mailLog)
    .orderBy(desc(schema.mailLog.createdAt))
    .limit(limit);
}
