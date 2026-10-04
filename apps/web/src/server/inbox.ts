import { desc, eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser, type Attachment } from "mailparser";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decrypt, encrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { DocumentError, uploadDocument } from "./documents.ts";

/**
 * Belege per E-Mail: Haben ruft ein Postfach über IMAP ab, legt die Anhänge ungelesener Mails als
 * Belege ab (E-Rechnungen gelesen, sonst KI-Auslesung wie beim Hochladen) und markiert die Mail
 * danach als gelesen. Jede Mail steht mit ihrer Message-ID genau einmal im Abrufprotokoll.
 */

export class InboxError extends Error {}

export const INBOX_ACTOR = "system:belege-mail";

/** Je Lauf höchstens so viele Mails; der Rest folgt beim nächsten Abruf */
const MAX_MESSAGES = 50;

export const IMAP_PRESETS = {
  gmail: { label: "Gmail", host: "imap.gmail.com", port: 993, secure: true },
  gmx: { label: "GMX", host: "imap.gmx.net", port: 993, secure: true },
  webde: { label: "web.de", host: "imap.web.de", port: 993, secure: true },
  posteo: { label: "Posteo", host: "posteo.de", port: 993, secure: true },
  mailbox: { label: "mailbox.org", host: "imap.mailbox.org", port: 993, secure: true },
} as const;

export const inboxSettingsSchema = z.object({
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
  enabled: z.boolean().default(true),
});

export type InboxSettingsInput = z.input<typeof inboxSettingsSchema>;
type InboxSettings = typeof schema.inboxSettings.$inferSelect;

/** Was ein Abruf braucht; im Test durch ein Postfach im Speicher ersetzt */
export interface InboxConnection {
  unseen(): Promise<number[]>;
  source(uid: number): Promise<Buffer>;
  markSeen(uid: number): Promise<void>;
  close(): Promise<void>;
}

type Connector = (settings: InboxSettings, password: string) => Promise<InboxConnection>;

async function imapConnect(settings: InboxSettings, password: string): Promise<InboxConnection> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.username, pass: password },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  const lock = await client.getMailboxLock(settings.folder);
  return {
    unseen: async () => {
      const found = await client.search({ seen: false }, { uid: true });
      return (found || []).sort((a, b) => a - b);
    },
    source: async (uid) => {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!message || !message.source) throw new InboxError(`Mail ${uid} ließ sich nicht laden.`);
      return message.source;
    },
    markSeen: async (uid) => {
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    },
    close: async () => {
      lock.release();
      await client.logout();
    },
  };
}

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
}

async function processMessage(actor: string, source: Buffer, background: (work: Promise<void>) => void) {
  const mail = await simpleParser(source);
  const messageId = mail.messageId?.trim() || `sha256:${createHash("sha256").update(source).digest("hex")}`;
  const [seen] = await db.select({ id: schema.inboxMessages.id }).from(schema.inboxMessages).where(eq(schema.inboxMessages.messageId, messageId));
  if (seen) return null;

  const from = mail.from?.value[0];
  const sender = from ? (from.name ? `${from.name} <${from.address ?? ""}>` : (from.address ?? "")) : "";
  const subject = mail.subject ?? "";
  const documentIds: string[] = [];
  const skipped: string[] = [];
  let duplicates = 0;
  const attachments = mail.attachments.filter(isBeleg);
  if (attachments.length === 0) skipped.push("keine Anhänge");
  for (const [index, attachment] of attachments.entries()) {
    const filename = attachment.filename?.trim() || `Anhang-${index + 1}`;
    try {
      const result = await uploadDocument(actor, { bytes: new Uint8Array(attachment.content), filename }, { background });
      if (result.duplicate) duplicates++;
      else documentIds.push(result.id);
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
      .values({ messageId: messageId.slice(0, 998), sender: sender.slice(0, 500), subject: subject.slice(0, 500), receivedAt: mail.date ?? null, documentIds, duplicates, skipped })
      .onConflictDoNothing({ target: schema.inboxMessages.messageId });
  });
  return { documents: documentIds.length, duplicates, skipped: skipped.length };
}

/** Ruft das Postfach einmal ab */
export async function fetchInbox(actor: string, background: (work: Promise<void>) => void = () => {}): Promise<InboxRunResult> {
  const settings = await loadInboxSettings();
  if (!settings) throw new InboxError("Es ist kein Postfach für Belege eingerichtet.");
  const result: InboxRunResult = { messages: 0, documents: 0, duplicates: 0, skipped: 0 };
  let error: string | null = null;
  try {
    const connection = await connector(settings, new TextDecoder().decode(decrypt(settings.ciphertext)));
    try {
      for (const uid of (await connection.unseen()).slice(0, MAX_MESSAGES)) {
        const done = await processMessage(actor, await connection.source(uid), background);
        // Erst nach dem Ablegen als gelesen markieren; schlägt etwas fehl, kommt die Mail beim nächsten Lauf wieder
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
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
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
