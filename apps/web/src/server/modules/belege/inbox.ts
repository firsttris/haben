import { desc, eq, or, sql } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { DocumentError, uploadDocument } from "./documents.ts";
import { normalizeSenders, senderAllowed } from "./inbox-absender.ts";
import { MAX_MAIL_SIZE } from "../../grenzen.ts";
import { clean, errorText, isBeleg, settle } from "./inbox-danach.ts";
import { type Connector, imapConnect, InboxError } from "./inbox-imap.ts";

/**
 * Belege per E-Mail: Haben ruft ein Postfach über IMAP ab, legt die Anhänge ungelesener Mails als
 * Belege ab (E-Rechnungen gelesen, sonst KI-Auslesung wie beim Hochladen) und markiert die Mail
 * danach als gelesen, verschiebt sie in einen Ordner oder löscht sie, je nach Einstellung. Jede Mail steht mit ihrer Message-ID genau einmal im Abrufprotokoll.
 */

export { InboxError };

export const INBOX_ACTOR = "system:belege-mail";

/** Je Lauf höchstens so viele Mails; der Rest folgt beim nächsten Abruf */
const MAX_MESSAGES = 50;

const IMAP_PRESETS = {
  gmail: { label: "Gmail", host: "imap.gmail.com", port: 993, secure: true },
  gmx: { label: "GMX", host: "imap.gmx.net", port: 993, secure: true },
  webde: { label: "web.de", host: "imap.web.de", port: 993, secure: true },
  posteo: { label: "Posteo", host: "posteo.de", port: 993, secure: true },
  mailbox: { label: "mailbox.org", host: "imap.mailbox.org", port: 993, secure: true },
} as const;

export const inboxSettingsSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1, "Server fehlt")
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/, "Nur der Servername, z. B. imap.gmail.com"),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().trim().min(1, "Benutzername fehlt").max(320),
    /** leer: das gespeicherte Passwort behalten */
    password: z.string().max(500).optional(),
    folder: z.string().trim().min(1, "Ordner fehlt").max(200).default("INBOX"),
    /** Ordner für Ausgangsrechnungen aus Fremdsystemen; leer: aus */
    outboundFolder: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((value) => value || null),
    /** Adresse oder Domain je Eintrag; leer: jeder Absender */
    allowedSenders: z
      .array(z.string().max(320))
      .max(200)
      .default([])
      .transform(normalizeSenders)
      .refine((list) => list.every((entry) => /^[^\s,;<>]+$/.test(entry)), "Je Eintrag eine Adresse oder Domain ohne Leerzeichen"),
    /** Was nach dem Ablegen mit der Mail im Postfach geschieht */
    afterFetch: z.enum(["seen", "move", "delete"]).default("seen"),
    /** Zielordner bei „move“ */
    archiveFolder: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((value) => value || null),
    enabled: z.boolean().default(true),
  })
  .refine((s) => s.afterFetch !== "move" || !!s.archiveFolder, {
    path: ["archiveFolder"],
    message: "Zielordner fehlt",
  })
  .refine(
    (s) => s.afterFetch !== "move" || !s.archiveFolder || ![s.folder, s.outboundFolder].some((f) => f?.toLowerCase() === s.archiveFolder?.toLowerCase()),
    {
      path: ["archiveFolder"],
      message: "Der Zielordner muss ein anderer sein als Eingangs- und Ausgangsordner",
    },
  )
  .refine((s) => !s.outboundFolder || s.outboundFolder.toLowerCase() !== s.folder.toLowerCase(), {
    path: ["outboundFolder"],
    message: "Ausgangsordner und Eingangsordner müssen verschieden sein",
  });

export type InboxSettingsInput = z.input<typeof inboxSettingsSchema>;
type InboxSettings = typeof schema.inboxSettings.$inferSelect;

let connector: Connector = imapConnect;

export function setInboxConnectorForTests(next: Connector | null): void {
  connector = next ?? imapConnect;
}

export async function loadInboxSettings(): Promise<InboxSettings | null> {
  const [row] = await db.select().from(schema.inboxSettings).where(eq(schema.inboxSettings.id, 1));
  return row ?? null;
}

/** Für die Oberfläche: alles außer dem Passwort */
export async function inboxSummary() {
  const settings = await loadInboxSettings();
  const last = await db.select().from(schema.inboxMessages).orderBy(desc(schema.inboxMessages.createdAt)).limit(5);
  return {
    settings: settings
      ? {
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          username: settings.username,
          folder: settings.folder,
          outboundFolder: settings.outboundFolder,
          allowedSenders: settings.allowedSenders,
          afterFetch: settings.afterFetch,
          archiveFolder: settings.archiveFolder,
          enabled: settings.enabled,
          lastRunAt: settings.lastRunAt,
          lastRejected: settings.lastRejected,
          lastError: settings.lastError,
        }
      : null,
    last,
    presets: IMAP_PRESETS,
  };
}

export async function saveInboxSettings(actor: string, input: InboxSettingsInput): Promise<void> {
  const { password, ...parsed } = inboxSettingsSchema.parse(input);
  const rest = { ...parsed, archiveFolder: parsed.afterFetch === "move" ? parsed.archiveFolder : null };
  const existing = await loadInboxSettings();
  if (!password && !existing) throw new InboxError("Passwort fehlt.");
  const values = {
    ...rest,
    ciphertext: password ? encrypt(new TextEncoder().encode(password)) : existing!.ciphertext,
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.inboxSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.inboxSettings.id, set: values }),
  );
}

export async function deleteInboxSettings(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.inboxSettings).where(eq(schema.inboxSettings.id, 1)));
}

export interface InboxRunResult {
  messages: number;
  documents: number;
  duplicates: number;
  skipped: number;
  /** Mails nicht freigegebener Absender, ungelesen im Postfach gelassen */
  rejected: number;
}

const FAILED = "Verarbeitung fehlgeschlagen: ";
/** Eintrag von recordFailure: keine Belege, nur der Grund; der Mail kann ein neuer Versuch folgen */
const isRetryable = (row: { skipped: string[]; documentIds: string[] }) => row.documentIds.length === 0 && !!row.skipped[0]?.startsWith(FAILED);
/** Schlüssel in inbox_messages */
const keyOf = (messageId: string) => messageId.slice(0, 998);
/** Schlüssel für das Nachholen einer Mail, deren erster Versuch fehlschlug */
const retryKey = (messageId: string, n: number) => `${messageId.slice(0, 970)}${n === 1 ? " (nachgeholt)" : ` (nachgeholt ${n})`}`;

/**
 * Der Schlüssel, unter dem diese Mail jetzt ins Abrufprotokoll kommt: der erste freie. null, wenn sie schon
 * abgelegt ist. Verarbeitung und Fehlerprotokoll nehmen denselben Schlüssel, sonst verschluckt
 * `onConflictDoNothing` den Eintrag eines Fehlschlags nach einem Nachholen.
 */
async function earlierRows(base: string) {
  const prefix = retryKey(base, 1).slice(0, -1);
  const rows = await db
    .select({
      messageId: schema.inboxMessages.messageId,
      skipped: schema.inboxMessages.skipped,
      documentIds: schema.inboxMessages.documentIds,
    })
    .from(schema.inboxMessages)
    .where(or(eq(schema.inboxMessages.messageId, base), sql`starts_with(${schema.inboxMessages.messageId}, ${prefix})`));
  // Nur Schlüssel aus retryKey; eine andere Mail kann eine Message-ID haben, die genauso beginnt
  return rows.filter((row) => row.messageId === base || /^(?:\)| [1-9]\d*\))$/.test(row.messageId.slice(prefix.length)));
}

async function freeKey(base: string): Promise<string | null> {
  const earlier = await earlierRows(base);
  // inbox_messages ist nur zu ergänzen: der Eintrag eines Fehlschlags bleibt stehen,
  // und wer die Mail wieder auf ungelesen setzt, holt sie unter einem eigenen Schlüssel nach
  if (earlier.some((row) => !isRetryable(row))) return null;
  const taken = new Set(earlier.map((row) => row.messageId));
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(retryKey(base, n))) n++;
  return retryKey(base, n);
}

async function processMessage(actor: string, source: { bytes: Buffer; tooLarge: boolean }, background: (work: Promise<void>) => void) {
  const mail = await simpleParser(source.bytes);
  const messageId = messageIdOf(mail, source.bytes);
  const key = await freeKey(keyOf(messageId));
  if (!key) return null;

  const from = mail.from?.value[0];
  const sender = clean(from ? (from.name ? `${from.name} <${from.address ?? ""}>` : (from.address ?? "")) : "");
  const subject = clean(mail.subject ?? "");
  const documentIds: string[] = [];
  const skipped: string[] = [];
  let created = 0;
  let duplicates = 0;
  const attachments = source.tooLarge ? [] : mail.attachments.filter(isBeleg);
  if (source.tooLarge) skipped.push(`Mail größer als ${MAX_MAIL_SIZE / 1024 / 1024} MB, Anhänge bitte einzeln hochladen`);
  else if (attachments.length === 0) skipped.push("keine Anhänge");
  for (const [index, attachment] of attachments.entries()) {
    const filename = clean(attachment.filename ?? "").trim() || `Anhang-${index + 1}`;
    const file = { bytes: new Uint8Array(attachment.content), filename };
    try {
      const result = await uploadDocument(actor, file, { background });
      if (result.duplicate) duplicates++;
      else {
        documentIds.push(result.id);
        created++;
      }
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      skipped.push(error.message);
    }
  }
  await withActor(actor, async (tx) => {
    for (const id of documentIds) {
      // Herkunft am Beleg vermerken, solange er noch nicht gebucht ist
      await tx
        .update(schema.documents)
        .set({ note: `Per E-Mail von ${sender}${subject ? `, Betreff „${subject}“` : ""}`.slice(0, 1000) })
        .where(eq(schema.documents.id, id));
    }
    await tx
      .insert(schema.inboxMessages)
      .values({
        messageId: key,
        sender: sender.slice(0, 500),
        subject: subject.slice(0, 500),
        receivedAt: mail.date ?? null,
        documentIds,
        duplicates,
        skipped,
      })
      .onConflictDoNothing({ target: schema.inboxMessages.messageId });
  });
  return { documents: created, duplicates, skipped: skipped.length };
}

function messageIdOf(mail: { messageId?: string }, bytes: Buffer) {
  return clean(mail.messageId ?? "").trim() || `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Eine Mail, an der die Verarbeitung scheitert, wird mit dem Fehler protokolliert und danach
 * als gelesen markiert. Sonst stünde sie bei jedem Abruf wieder vorn und hielte alle späteren auf.
 */
async function recordFailure(actor: string, bytes: Buffer, error: unknown) {
  const mail = await simpleParser(bytes).catch(() => null);
  const from = mail?.from?.value[0];
  const key = await freeKey(keyOf(mail ? messageIdOf(mail, bytes) : messageIdOf({}, bytes)));
  if (!key) return;
  await withActor(actor, (tx) =>
    tx
      .insert(schema.inboxMessages)
      .values({
        messageId: key,
        sender: clean(from?.address ?? "").slice(0, 500),
        subject: clean(mail?.subject ?? "").slice(0, 500),
        receivedAt: mail?.date ?? null,
        documentIds: [],
        duplicates: 0,
        skipped: [`${FAILED}${errorText(error)}`.slice(0, 1000)],
      })
      .onConflictDoNothing({ target: schema.inboxMessages.messageId }),
  );
}

/**
 * Freigegebene Mails verarbeiten und danach gelesen markieren, verschieben oder löschen. Mails anderer Absender bleiben ungelesen; von ihnen
 * wird nur die Absenderadresse aus dem Umschlag gelesen und die Anzahl gezählt, nichts gespeichert.
 */
async function fetchFolder(
  settings: InboxSettings,
  password: string,
  actor: string,
  background: (work: Promise<void>) => void,
  result: InboxRunResult,
  problems: string[],
) {
  const connection = await connector(settings, password, settings.folder);
  try {
    let handled = 0;
    for (const uid of await connection.unseen()) {
      if (handled >= MAX_MESSAGES) break;
      if (!senderAllowed(await connection.sender(uid), settings.allowedSenders)) {
        result.rejected++;
        continue;
      }
      handled++;
      const source = await connection.source(uid);
      let done: Awaited<ReturnType<typeof processMessage>>;
      let ok = true;
      try {
        done = await processMessage(actor, source, background);
      } catch (failure) {
        // Lässt sich nicht einmal der Fehler speichern (Datenbank weg), bricht der Lauf ab und die Mail bleibt ungelesen
        await recordFailure(actor, source.bytes, failure);
        done = { documents: 0, duplicates: 0, skipped: 1 };
        ok = false;
      }
      // Erst nach dem Ablegen oder Protokollieren
      const problem = await settle(connection, settings, uid, source, ok);
      if (problem) problems.push(problem);
      if (!done) continue;
      result.messages++;
      result.documents += done.documents;
      result.duplicates += done.duplicates;
      result.skipped += done.skipped;
    }
  } finally {
    await connection.close();
  }
}

/** Ruft das Postfach einmal ab (den Ordner für Eingangsrechnungen) */
export async function fetchInbox(actor: string, background: (work: Promise<void>) => void = () => {}): Promise<InboxRunResult> {
  const settings = await loadInboxSettings();
  if (!settings) throw new InboxError("Es ist kein Postfach für Belege eingerichtet.");
  const result: InboxRunResult = { messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 0 };
  let error: string | null = null;
  const problems: string[] = [];
  try {
    const password = new TextDecoder().decode(decrypt(settings.ciphertext));
    await fetchFolder(settings, password, actor, background, result, problems);
  } catch (e) {
    error = errorText(e);
  }
  // Ein Mail, die sich nicht verschieben oder löschen ließ, hält den Abruf nicht an; der Fehler steht danach in lastError
  const settleError = problems[0] ? `${problems[0]}${problems.length > 1 ? ` (und ${problems.length - 1} weitere)` : ""}` : null;
  await db
    .update(schema.inboxSettings)
    .set({ lastRunAt: new Date(), lastRejected: result.rejected, lastError: error ?? settleError })
    .where(eq(schema.inboxSettings.id, 1));
  if (error) throw new InboxError(`Abruf fehlgeschlagen: ${error}`);
  return result;
}

/** Für den stündlichen Hintergrundjob */
export async function runDueInboxFetch(): Promise<InboxRunResult | null> {
  const settings = await loadInboxSettings();
  if (!settings?.enabled) return null;
  return fetchInbox(INBOX_ACTOR, (work) => void work.catch((e: unknown) => console.error("KI-Auslesung", e)));
}
