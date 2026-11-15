import { and, desc, eq, sql } from "drizzle-orm";
import { dateiBefund, dateienText } from "../../../lib/pruefbericht.ts";
import { db, schema } from "../../db/index.ts";
import { baseUrl, berlinHour, escapeHtml, loadMailSettings, MAIL_ACTOR, MailError, send } from "../mail/index.ts";
import { chainHead, checkIntegrity, formatPruefwert, type IntegrityReport } from "./integrity.ts";

/** Wöchentliche Mail mit dem Prüfwert des Änderungsprotokolls; Versand und Protokoll über mail */

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Ob das Audit-Log seit Eintrag seq mehr enthält als die Protokollzeilen der Prüfwert-Mails selbst */
async function changedSince(seq: number): Promise<boolean> {
  const [row] = await db
    .select({ seq: schema.auditLog.seq })
    .from(schema.auditLog)
    .where(sql`${schema.auditLog.seq} > ${seq} and not (${schema.auditLog.tableName} = 'mail_log' and ${schema.auditLog.newValue} ->> 'kind' = 'pruefwert')`)
    .limit(1);
  return row !== undefined;
}

/** Hash des Eintrags seq, null wenn es ihn nicht gibt */
async function rowHashAt(seq: number): Promise<string | null> {
  const [row] = await db.select({ hash: schema.auditLog.rowHash }).from(schema.auditLog).where(eq(schema.auditLog.seq, seq));
  return row ? row.hash.toString("hex") : null;
}

const zeitpunkt = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" });

/** Absatz zur letzten Vollprüfung der Dateien: Befund mit den ersten drei Dateien, sonst die Zahl der geprüften */
function dateienAbsatz(files: IntegrityReport["files"]): { befund: string | null; unveraendert: string } {
  if (!files) return { befund: null, unveraendert: "" };
  const kopf = `Belegdateien (Prüfung vom ${zeitpunkt.format(files.at)})`;
  if (files.problemCount === 0) return { befund: null, unveraendert: ` ${kopf}: ${files.files} vorhanden und unverändert.` };
  const erste = files.problems.slice(0, 3).map(dateiBefund).join("; ");
  return { befund: `${kopf}: ${dateienText(files.problemCount)} (${erste}${files.problemCount > 3 ? " …" : ""}).`, unveraendert: "" };
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
  if (!changed && !rewritten && report.problems.length === 0 && report.abgleich.abweichungen.length === 0 && !report.files?.problemCount) {
    quietCheckAt = now.getTime();
    return null;
  }

  const pruefwert = formatPruefwert(head);
  const stand = zeitpunkt.format(now);
  const dateien = dateienAbsatz(report.files);
  const findings = [
    ...(rewritten
      ? [
          lastNow === null
            ? `Eintrag Nr. ${lastSeq} aus der letzten Mail fehlt im Protokoll: Einträge wurden gelöscht oder ein älteres Backup eingespielt.`
            : `Eintrag Nr. ${lastSeq} aus der letzten Mail hat jetzt einen anderen Hash (${lastNow} statt ${lastHash}): Das Protokoll wurde nachträglich verändert und neu verkettet.`,
        ]
      : []),
    ...(report.problems.length > 0
      ? [
          `Prüfung von Kette, Siegeln und Sperren: ${report.problems.length}${report.truncated ? " oder mehr" : ""} Befunde. Die Datenbank wurde außerhalb von Haben verändert.`,
          ...report.problems.filter((problem) => problem.art === "sperre").map((problem) => `${problem.tabelle}: ${problem.befund}.`),
        ]
      : []),
    ...(report.abgleich.abweichungen.length > 0
      ? [
          `Abgleich von Journal und Steuerwerten: ${report.abgleich.abweichungen.length} ${report.abgleich.abweichungen.length === 1 ? "Abweichung" : "Abweichungen"} (${report.abgleich.abweichungen
            .slice(0, 3)
            .map((a) => `${a.zeitraum} ${a.posten}`)
            .join("; ")}${report.abgleich.abweichungen.length > 3 ? " …" : ""}).`,
        ]
      : []),
    ...(dateien.befund ? [dateien.befund] : []),
  ];
  const befund =
    findings.length === 0
      ? `Prüfung von Kette, Siegeln und Sperren: unverändert (${report.entries} Einträge, ${report.seals} Siegel).${dateien.unveraendert}`
      : `${findings.join(" ")} Einzelheiten unter ${baseUrl()}/einstellungen?bereich=export`;
  const intro = `Prüfwert des Änderungsprotokolls von Haben (${baseUrl()}), Stand ${stand}:`;
  const aufbewahren =
    "Bitte diese Mail aufbewahren, nicht nur auf dem Server von Haben. Mit dem Prüfwert lässt sich später zeigen, dass das Änderungsprotokoll und die festgeschriebenen Daten bis zu diesem Stand nicht nachträglich verändert wurden: in Haben unter Einstellungen → Export → Änderungsprotokoll prüfen einfügen und vergleichen.";
  const hinweis =
    "Diese Mail kommt höchstens einmal pro Woche, wenn sich etwas geändert hat oder die Prüfung etwas findet. Abschalten in den E-Mail-Einstellungen.";
  const triggerHints = report.triggerHints.join("; ");
  const text = [intro, "", pruefwert, "", befund, ...(triggerHints ? ["", triggerHints] : []), "", aufbewahren, "", hinweis].join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p><code>${escapeHtml(pruefwert)}</code></p>`,
    `<p>${escapeHtml(befund)}</p>`,
    ...(triggerHints ? [`<p>${escapeHtml(triggerHints)}</p>`] : []),
    `<p>${escapeHtml(aufbewahren)}</p>`,
    `<p><small>${escapeHtml(hinweis)}</small></p>`,
  ].join("\n");
  const subject =
    findings.length === 0 ? `Haben: Prüfwert des Änderungsprotokolls (Nr. ${head.seq})` : `Haben: Änderungsprotokoll mit Befunden (Nr. ${head.seq})`;
  const result = await send(MAIL_ACTOR, { kind: "pruefwert", to: settings.reminderTo, subject, text, html, reminderKeys: [String(head.seq), head.hash] });
  if (!result.ok) throw new MailError(`Prüfwert nicht gesendet: ${result.error}`);
  return { seq: head.seq, problems: report.problems.length, rewritten, fileProblems: report.files?.problemCount ?? 0 };
}
