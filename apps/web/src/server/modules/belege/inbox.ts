import { desc, eq, inArray } from "drizzle-orm";
import { simpleParser, type Attachment } from "mailparser";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { DocumentError, uploadDocument } from "./documents.ts";
import { normalizeSenders, senderAllowed } from "./inbox-absender.ts";
import { MAX_MAIL_SIZE } from "../../grenzen.ts";
import { type Connector, imapConnect, InboxError, type MailEnvelope } from "./inbox-imap.ts";

/**
 * Belege per E-Mail: Haben ruft ein Postfach über IMAP ab, legt die Anhänge ungelesener Mails als
 * Belege ab (E-Rechnungen gelesen, sonst KI-Auslesung wie beim Hochladen) und markiert die Mail
 * danach als gelesen. Jede Mail steht mit ihrer Message-ID genau einmal im Abrufprotokoll.
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
    enabled: z.boolean().default(true),
  })
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
          enabled: settings.enabled,
          lastRunAt: settings.lastRunAt,
          lastError: settings.lastError,
        }
      : null,
    last,
    presets: IMAP_PRESETS,
  };
}

export async function saveInboxSettings(actor: string, input: InboxSettingsInput): Promise<void> {
  const { password, ...rest } = inboxSettingsSchema.parse(input);
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

/** Signaturbilder und eingebettete Logos sind keine Belege */
function isBeleg(attachment: Attachment): boolean {
  if (attachment.related) return false;
  if (attachment.contentDisposition === "inline" && attachment.contentType.startsWith("image/")) return false;
  return true;
}

export interface InboxRunResult {
  messages: number;
  documents: number;
  duplicates: number;
  skipped: number;
  /** Mails nicht freigegebener Absender, ungelesen im Postfach gelassen */
  rejected: number;
}

type Richtung = "eingang" | "ausgang";

const FAILED = "Verarbeitung fehlgeschlagen: ";
const REJECTED = "Absender nicht freigegeben: ";
/** Eintrag von recordFailure oder recordRejected: keine Belege, nur der Grund; der Mail kann ein neuer Versuch folgen */
const isRetryable = (row: { skipped: string[]; documentIds: string[] }) =>
  row.documentIds.length === 0 && !!(row.skipped[0]?.startsWith(FAILED) || row.skipped[0]?.startsWith(REJECTED));
/** Schlüssel in inbox_messages: dieselbe Mail im Eingangs- und im Ausgangsordner zählt zweimal */
const keyOf = (messageId: string, richtung: Richtung) => (richtung === "ausgang" ? `${messageId.slice(0, 980)} (ausgang)` : messageId.slice(0, 998));
/** Schlüssel für das Nachholen einer Mail, deren erster Versuch fehlschlug */
const retryKey = (messageId: string, n: number) => `${messageId.slice(0, 970)}${n === 1 ? " (nachgeholt)" : ` (nachgeholt ${n})`}`;
/** Der Schlüssel und bis zu fünf Nachhol-Schlüssel einer Mail */
const keysOf = (base: string) => [base, ...[1, 2, 3, 4, 5].map((n) => retryKey(base, n))];

/**
 * Der Schlüssel, unter dem diese Mail jetzt ins Abrufprotokoll kommt: der erste freie. null, wenn sie schon
 * abgelegt ist oder alle Schlüssel vergeben sind. Verarbeitung und Fehlerprotokoll nehmen denselben Schlüssel,
 * sonst verschluckt `onConflictDoNothing` den Eintrag eines Fehlschlags nach einem Nachholen.
 */
async function freeKey(base: string): Promise<string | null> {
  const earlier = await db
    .select({ messageId: schema.inboxMessages.messageId, skipped: schema.inboxMessages.skipped, documentIds: schema.inboxMessages.documentIds })
    .from(schema.inboxMessages)
    .where(inArray(schema.inboxMessages.messageId, keysOf(base)));
  // inbox_messages ist nur zu ergänzen: der Eintrag eines Fehlschlags oder einer Ablehnung bleibt stehen,
  // und wer die Mail wieder auf ungelesen setzt, holt sie unter einem eigenen Schlüssel nach
  if (earlier.some((row) => !isRetryable(row))) return null;
  const taken = new Set(earlier.map((row) => row.messageId));
  return keysOf(base).find((key) => !taken.has(key)) ?? null;
}

/** Steuerzeichen aus Mail-Kopfzeilen entfernen: Postgres-Text nimmt kein NUL an, und im Beleg stört der Rest */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind hier gesucht
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, "");

/** Die Ursache statt der Drizzle-Hülle mit der ganzen Abfrage */
const errorText = (e: unknown) => clean(e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

/**
 * Übernahme einer Ausgangsrechnung aus einem Anhang. Noch nichts eingehängt: Haben kennt fremde
 * Ausgangsrechnungen erst mit #660. Ohne Übernahme bleibt der Ausgangsordner unberührt.
 */
export type OutboundHandler = (
  actor: string,
  file: { bytes: Uint8Array; filename: string },
  options: { background: (work: Promise<void>) => void },
) => Promise<{ id: string; duplicate: boolean }>;

let outboundHandler: OutboundHandler | null = null;

export function setOutboundHandler(next: OutboundHandler | null): void {
  outboundHandler = next;
}

async function processMessage(actor: string, richtung: Richtung, source: { bytes: Buffer; tooLarge: boolean }, background: (work: Promise<void>) => void) {
  const mail = await simpleParser(source.bytes);
  const messageId = messageIdOf(mail, source.bytes);
  const key = await freeKey(keyOf(messageId, richtung));
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
      if (richtung === "eingang") {
        const result = await uploadDocument(actor, file, { background });
        if (result.duplicate) duplicates++;
        else {
          documentIds.push(result.id);
          created++;
        }
      } else {
        const result = await outboundHandler!(actor, file, { background });
        if (result.duplicate) duplicates++;
        else created++;
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
        direction: richtung,
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
async function recordFailure(actor: string, richtung: Richtung, bytes: Buffer, error: unknown) {
  const mail = await simpleParser(bytes).catch(() => null);
  const from = mail?.from?.value[0];
  const key = await freeKey(keyOf(mail ? messageIdOf(mail, bytes) : messageIdOf({}, bytes), richtung));
  if (!key) return;
  await withActor(actor, (tx) =>
    tx
      .insert(schema.inboxMessages)
      .values({
        messageId: key,
        direction: richtung,
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
 * Mail eines nicht freigegebenen Absenders: nur der Umschlag wird gelesen, die Mail bleibt ungelesen
 * im Postfach und wird beim nächsten Abruf nicht noch einmal protokolliert.
 */
/** Ohne Message-ID: Hash aus Absender, Betreff und Datum; die UID allein gilt nur je Ordner und Gültigkeitsstand */
const ersatzId = (head: MailEnvelope) =>
  `ohne-id:${createHash("sha256")
    .update(`${head.address}\n${head.subject}\n${head.date?.toISOString() ?? ""}`)
    .digest("hex")}`;

async function recordRejected(actor: string, richtung: Richtung, head: MailEnvelope) {
  const id = clean(head.messageId).trim() || ersatzId(head);
  await withActor(actor, (tx) =>
    tx
      .insert(schema.inboxMessages)
      .values({
        messageId: keyOf(id, richtung),
        direction: richtung,
        sender: clean(head.address).slice(0, 500),
        subject: clean(head.subject).slice(0, 500),
        receivedAt: head.date,
        documentIds: [],
        duplicates: 0,
        skipped: [`${REJECTED}${clean(head.address) || "ohne Absender"}`.slice(0, 1000)],
      })
      .onConflictDoNothing({ target: schema.inboxMessages.messageId }),
  );
}

/** Ein Ordner: freigegebene Mails verarbeiten und als gelesen markieren, die übrigen unberührt lassen */
async function fetchFolder(
  settings: InboxSettings,
  password: string,
  folder: string,
  richtung: Richtung,
  actor: string,
  background: (work: Promise<void>) => void,
  result: InboxRunResult,
) {
  const connection = await connector(settings, password, folder);
  try {
    let handled = 0;
    for (const uid of await connection.unseen()) {
      if (handled >= MAX_MESSAGES) break;
      const head = await connection.envelope(uid);
      if (!senderAllowed(head.address, settings.allowedSenders)) {
        await recordRejected(actor, richtung, head);
        result.rejected++;
        continue;
      }
      handled++;
      const source = await connection.source(uid);
      let done: Awaited<ReturnType<typeof processMessage>>;
      try {
        done = await processMessage(actor, richtung, source, background);
      } catch (failure) {
        // Lässt sich nicht einmal der Fehler speichern (Datenbank weg), bricht der Lauf ab und die Mail bleibt ungelesen
        await recordFailure(actor, richtung, source.bytes, failure);
        done = { documents: 0, duplicates: 0, skipped: 1 };
      }
      // Erst nach dem Ablegen oder Protokollieren als gelesen markieren
      await connection.markSeen(uid);
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

/** Ruft das Postfach einmal ab: den Eingangsordner und, wenn eingerichtet und die Übernahme vorhanden ist, den Ausgangsordner */
export async function fetchInbox(actor: string, background: (work: Promise<void>) => void = () => {}): Promise<InboxRunResult> {
  const settings = await loadInboxSettings();
  if (!settings) throw new InboxError("Es ist kein Postfach für Belege eingerichtet.");
  const result: InboxRunResult = { messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 0 };
  let error: string | null = null;
  try {
    const password = new TextDecoder().decode(decrypt(settings.ciphertext));
    await fetchFolder(settings, password, settings.folder, "eingang", actor, background, result);
    if (settings.outboundFolder && outboundHandler) await fetchFolder(settings, password, settings.outboundFolder, "ausgang", actor, background, result);
  } catch (e) {
    error = errorText(e);
  }
  await db.update(schema.inboxSettings).set({ lastRunAt: new Date(), lastError: error }).where(eq(schema.inboxSettings.id, 1));
  if (error) throw new InboxError(`Abruf fehlgeschlagen: ${error}`);
  return result;
}

/** Für den stündlichen Hintergrundjob */
export async function runDueInboxFetch(): Promise<InboxRunResult | null> {
  const settings = await loadInboxSettings();
  if (!settings?.enabled) return null;
  return fetchInbox(INBOX_ACTOR, (work) => void work.catch((e: unknown) => console.error("KI-Auslesung", e)));
}
