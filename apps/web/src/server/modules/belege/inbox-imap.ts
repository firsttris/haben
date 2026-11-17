import { ImapFlow } from "imapflow";
import type { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { MAX_MAIL_SIZE } from "../../grenzen.ts";

/** Der IMAP-Teil des Postfachs für Belege: Verbindung, Umschlag und Quelltext einer Mail */

export class InboxError extends UserError {}

type InboxSettings = typeof schema.inboxSettings.$inferSelect;

/** Was ein Abruf braucht; im Test durch ein Postfach im Speicher ersetzt */
export interface InboxConnection {
  unseen(): Promise<number[]>;
  /** Absenderadresse aus dem Umschlag, ohne die Mail zu laden */
  sender(uid: number): Promise<string>;
  /** Quelltext der Mail; ist sie größer als MAX_MAIL_SIZE, nur die Kopfzeilen */
  source(uid: number): Promise<{ bytes: Buffer; tooLarge: boolean }>;
  markSeen(uid: number): Promise<void>;
  close(): Promise<void>;
}

export type Connector = (settings: InboxSettings, password: string, folder: string) => Promise<InboxConnection>;

export async function imapConnect(settings: InboxSettings, password: string, folder: string): Promise<InboxConnection> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.username, pass: password },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>>;
  try {
    lock = await client.getMailboxLock(folder);
  } catch (error) {
    // z. B. Ordner gibt es nicht: Verbindung nicht offen lassen
    await client.logout().catch(() => {});
    throw error;
  }
  return {
    unseen: async () => {
      const found = await client.search({ seen: false }, { uid: true });
      return (found || []).sort((a, b) => a - b);
    },
    sender: async (uid) => {
      const head = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
      return head ? (head.envelope?.from?.[0]?.address ?? "") : "";
    },
    source: async (uid) => {
      // Erst die Größe, damit eine riesige Mail gar nicht erst in den Speicher kommt
      const head = await client.fetchOne(String(uid), { size: true, headers: true }, { uid: true });
      if (head && head.size !== undefined && head.size > MAX_MAIL_SIZE && head.headers) {
        return { bytes: Buffer.concat([head.headers, Buffer.from("\r\n")]), tooLarge: true };
      }
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      // biome-ignore lint/complexity/useOptionalChain: fetchOne liefert auch false, ?. prüft nur auf null und undefined
      if (!message || !message.source) throw new InboxError(`Mail ${uid} ließ sich nicht laden.`);
      return { bytes: message.source, tooLarge: false };
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
