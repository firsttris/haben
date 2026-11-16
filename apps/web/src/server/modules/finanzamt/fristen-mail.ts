import { tageBis } from "@haben/core";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { baseUrl, berlinHour, escapeHtml, loadMailSettings, MAIL_ACTOR, MailError, send } from "../mail/index.ts";
import { listFristen, type Frist } from "./fristen.ts";

/** Erinnerungen an Steuerfristen per E-Mail; Versand und Protokoll über mail */

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
  const subject = neu.length === 1 ? `Frist ${wann(neu[0]!.tage)}: ${neu[0]!.frist.titel}` : `${neu.length} Steuerfristen stehen an`;
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
      ({ frist, text }) => `<li><a href="${escapeHtml(baseUrl() + frist.link)}">${escapeHtml(text)}</a><br><small>${escapeHtml(frist.detail)}</small></li>`,
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
