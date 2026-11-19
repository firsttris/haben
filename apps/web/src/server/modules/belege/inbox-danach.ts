import { simpleParser, type Attachment } from "mailparser";
import { inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadFile, sha256Of } from "../../storage.ts";
import type { InboxConnection } from "./inbox-imap.ts";

/** Der Abruf aus dem Postfach: was nach dem Ablegen mit einer Mail im Postfach geschieht, und die Hilfen dafür */

type InboxSettings = typeof schema.inboxSettings.$inferSelect;

/** Signaturbilder und eingebettete Logos sind keine Belege */
export function isBeleg(attachment: Attachment): boolean {
  if (attachment.related) return false;
  if (attachment.contentDisposition === "inline" && attachment.contentType.startsWith("image/")) return false;
  return true;
}

/** Steuerzeichen aus Mail-Kopfzeilen entfernen: Postgres-Text nimmt kein NUL an, und im Beleg stört der Rest */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind hier gesucht
export const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, "");

/** Die Ursache statt der Drizzle-Hülle mit der ganzen Abfrage */
export const errorText = (e: unknown) => clean(e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

/**
 * Liegt jeder Beleganhang dieser Mail jetzt in Haben vor (Beleg in `documents` und Datei abrufbar)? Nur dann darf die Mail
 * beim Löschen weg. Geprüft wird der Bestand, nicht das Abrufprotokoll: ein Beleg kann seither gelöscht worden sein, und eine
 * andere Mail kann dieselbe Message-ID tragen.
 */
export async function attachmentsStored(source: { bytes: Buffer; tooLarge: boolean }): Promise<boolean> {
  if (source.tooLarge) return false;
  const mail = await simpleParser(source.bytes);
  const hashes = [...new Set(mail.attachments.filter(isBeleg).map((attachment) => sha256Of(new Uint8Array(attachment.content))))];
  if (hashes.length === 0) return false;
  const rows = await db.select({ sha256: schema.documents.sha256 }).from(schema.documents).where(inArray(schema.documents.sha256, hashes));
  const present = new Set(rows.map((row) => row.sha256));
  for (const hash of hashes) {
    if (!present.has(hash)) return false;
    try {
      await loadFile(hash);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Was nach dem Ablegen mit der Mail geschieht. Verschoben oder gelöscht wird nur, was fehlerfrei abgelegt oder
 * protokolliert ist; gelöscht außerdem nur, wenn jeder Beleganhang in Haben vorliegt. Sonst bleibt sie, als gelesen markiert.
 * Scheitert das Verschieben oder Löschen (etwa wegen eines falschen Zielordners), wird die Mail gelesen markiert und der
 * Fehler zurückgegeben, damit der Abruf nicht an dieser Mail hängen bleibt.
 */
export async function settle(
  connection: InboxConnection,
  settings: InboxSettings,
  uid: number,
  source: { bytes: Buffer; tooLarge: boolean },
  ok: boolean,
): Promise<string | null> {
  try {
    if (ok && settings.afterFetch === "move" && settings.archiveFolder) {
      await connection.move(uid, settings.archiveFolder);
      return null;
    }
    if (ok && settings.afterFetch === "delete" && (await attachmentsStored(source))) {
      await connection.remove(uid);
      return null;
    }
  } catch (error) {
    await connection.markSeen(uid);
    return errorText(error);
  }
  await connection.markSeen(uid);
  return null;
}
