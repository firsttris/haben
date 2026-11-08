import { and, asc, eq, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { withActor } from "../../db/actor.ts";
import { fileInUse, lockFileUse } from "../../db/file-in-use.ts";
import { db, type schema, type Db, type Tx } from "../../db/index.ts";
import { loadFile, removeFile, sha256Of, sniff, storeFile } from "../../storage.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";

/**
 * Zusätzliche PDF-Anhänge an Rechnungen (#272) und Angeboten (#415), einmal gebaut: Prüfung der Datei, Dateiname,
 * Ablage unter SHA-256 mit Sperre auf den Hash, Auswahl für die E-Mail. Was je Belegart anders ist (Tabelle, Spalte des
 * Belegs, Sperre des Entwurfs, Fehlerart, Wortlaut), kommt als Beschreibung herein. Die Sperre nach dem Festschreiben
 * liegt in der Datenbank (invoice_attachments_locked in 0125, quote_attachments_locked in 0164).
 */

export type AttachmentFile = { bytes: Uint8Array; filename: string };
export type Attachment = { id: string; filename: string; size: number; sha256: string; createdAt: Date };
export type MailAttachment = { filename: string; content: Buffer; contentType: string };

type AttachmentTable = typeof schema.invoiceAttachments | typeof schema.quoteAttachments;

export interface AttachmentOwner {
  table: AttachmentTable;
  /** Spalte mit dem Beleg, an dem der Anhang hängt */
  owner: AnyPgColumn;
  /** Werte einer neuen Zeile für den Beleg */
  ownerValues: (ownerId: string) => Record<string, string>;
  /** Sperrt den Entwurf für die Transaktion; wirft, wenn es keiner (mehr) ist */
  lockDraft: (tx: Tx, ownerId: string) => Promise<unknown>;
  fail: (message: string) => Error;
  /** „je Rechnung“, „je Angebot“ */
  perOwner: string;
  /** „zu dieser Rechnung“, „zu diesem Angebot“ */
  ofOwner: string;
}

/** Was gegen die Datei als Anhang spricht, oder null; Typ am Inhalt erkannt, Grenze wie bei Belegen */
export function attachmentFileProblem(file: AttachmentFile): string | null {
  if (file.bytes.byteLength === 0) return `${file.filename}: Die Datei ist leer.`;
  if (file.bytes.byteLength > MAX_DOCUMENT_SIZE) return `${file.filename}: größer als 20 MB.`;
  if (sniff(file.bytes)?.kind !== "pdf") return `${file.filename}: Als Anhang sind nur PDF-Dateien erlaubt.`;
  return null;
}

/** Dateiname ohne Pfad und Steuerzeichen, wie er in der E-Mail und im Archiv erscheint */
export function attachmentFilename(raw: string): string {
  const name = (raw.split(/[\\/]/).pop() ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gehören nicht in einen Dateinamen
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  if (!name) return "Anhang.pdf";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** Welche der Dateien nach dem Löschen niemand mehr nutzt; in derselben Transaktion fragen */
export async function unusedFiles(tx: Tx, hashes: string[]): Promise<string[]> {
  const unused: string[] = [];
  for (const sha256 of new Set(hashes)) if (!(await fileInUse(tx, sha256))) unused.push(sha256);
  return unused;
}

/**
 * Nach dem Commit: nicht mehr genutzte Dateien aus dem Speicher nehmen. Unter der Sperre auf den Hash noch einmal
 * prüfen: Ein Anhang, der die Datei inzwischen nutzt, war bei der Prüfung in der Transaktion noch nicht sichtbar.
 */
export async function removeFiles(hashes: string[]): Promise<void> {
  for (const sha256 of hashes) {
    await db.transaction(async (tx) => {
      await lockFileUse(tx, sha256);
      if (!(await fileInUse(tx, sha256))) await removeFile(sha256);
    });
  }
}

/** Legt die geprüfte Datei unter der Sperre auf ihren Hash ab (siehe add); liefert, was eine neue Zeile braucht */
export async function storeAttachmentFile(tx: Tx, file: AttachmentFile): Promise<{ filename: string; sha256: string; size: number }> {
  const sha256 = sha256Of(file.bytes);
  await lockFileUse(tx, sha256);
  await storeFile(file.bytes);
  return { filename: attachmentFilename(file.filename), sha256, size: file.bytes.byteLength };
}

/** Die Funktionen für die Anhänge einer Belegart */
export function attachmentStore(spec: AttachmentOwner) {
  const { table, owner, fail } = spec;
  const order = [asc(table.createdAt), asc(table.id)] as const;

  async function list(ownerId: string, q: Db | Tx = db): Promise<Attachment[]> {
    return q
      .select({ id: table.id, filename: table.filename, size: table.size, sha256: table.sha256, createdAt: table.createdAt })
      .from(table)
      .where(eq(owner, ownerId))
      .orderBy(...order);
  }

  async function insert(tx: Tx, ownerId: string, row: { filename: string; sha256: string; size: number; createdAt?: Date }): Promise<string> {
    const values = {
      ...spec.ownerValues(ownerId),
      filename: row.filename,
      mimeType: "application/pdf",
      sha256: row.sha256,
      size: row.size,
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    };
    // Beide Tabellen haben dieselben Spalten bis auf die des Belegs; die liefert ownerValues
    const [created] = await tx
      .insert(table)
      .values(values as never)
      .returning({ id: table.id });
    return created!.id;
  }

  /**
   * Hängt eine PDF-Datei an einen Entwurf. Dieselbe Datei ein zweites Mal liefert den vorhandenen Anhang. Die Datei wird
   * unter der Sperre auf ihren Hash (lockFileUse) abgelegt, damit ein gleichzeitiges Entfernen derselben Datei an anderer
   * Stelle sie nicht nach dem Ablegen löscht; scheitert die Transaktion, bleibt sie unter ihrem Hash liegen, ohne Schaden.
   */
  async function add(actor: string, ownerId: string, file: AttachmentFile): Promise<{ id: string; duplicate: boolean }> {
    const problem = attachmentFileProblem(file);
    if (problem) throw fail(problem);
    return withActor(actor, async (tx) => {
      await spec.lockDraft(tx, ownerId);
      const stored = await storeAttachmentFile(tx, file);
      const existing = await list(ownerId, tx);
      const same = existing.find((a) => a.sha256 === stored.sha256);
      if (same) return { id: same.id, duplicate: true };
      if (existing.length >= MAX_INVOICE_ATTACHMENTS) throw fail(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Anhänge ${spec.perOwner}.`);
      return { id: await insert(tx, ownerId, stored), duplicate: false };
    });
  }

  /** Entfernt einen Anhang aus dem Entwurf; die Datei geht mit, solange sie sonst niemand nutzt */
  async function remove(actor: string, ownerId: string, attachmentId: string): Promise<void> {
    const unused = await withActor(actor, async (tx) => {
      await spec.lockDraft(tx, ownerId);
      const [removed] = await tx
        .delete(table)
        .where(and(eq(table.id, attachmentId), eq(owner, ownerId)))
        .returning({ sha256: table.sha256 });
      if (!removed) throw fail("Anhang nicht gefunden.");
      return unusedFiles(tx, [removed.sha256]);
    });
    await removeFiles(unused);
  }

  /** Dateien der Anhänge eines Belegs, bevor er gelöscht wird (Entwurf löschen) */
  async function files(tx: Tx, ownerId: string): Promise<string[]> {
    return (await list(ownerId, tx)).map((a) => a.sha256);
  }

  /**
   * Übernimmt die Anhänge eines Belegs in einen neuen Entwurf (Kopieren), in derselben Transaktion. Der Zeitpunkt des Anhängens bleibt der des Originals, sonst stünden alle Kopien gleichzeitig und ohne Reihenfolge.
   */
  async function copy(tx: Tx, fromId: string, toId: string): Promise<void> {
    await attachStored(tx, toId, await list(fromId, tx));
  }

  /**
   * Hängt Dateien, die schon im Speicher liegen (Kopie, Standardanhänge), an einen neuen Entwurf, in der Transaktion,
   * die ihn anlegt; die Sperre auf den Hash hält ein gleichzeitiges Entfernen ab, bis die neuen Zeilen sichtbar sind.
   */
  async function attachStored(tx: Tx, ownerId: string, rows: { filename: string; sha256: string; size: number; createdAt?: Date }[]): Promise<void> {
    for (const row of rows) {
      await lockFileUse(tx, row.sha256);
      await insert(tx, ownerId, row);
    }
  }

  /** Datei eines Anhangs zum Herunterladen, auch nach dem Festschreiben */
  async function load(id: string): Promise<{ filename: string; mimeType: string; bytes: Buffer } | null> {
    const [row] = await db.select({ filename: table.filename, mimeType: table.mimeType, sha256: table.sha256 }).from(table).where(eq(table.id, id));
    if (!row) return null;
    return { filename: row.filename, mimeType: row.mimeType, bytes: await loadFile(row.sha256) };
  }

  /** Die ausgewählten Anhänge für die E-Mail, in der Reihenfolge am Beleg; fremde Anhänge lehnt Haben ab */
  async function forMail(ownerId: string, ids: string[]): Promise<MailAttachment[]> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ filename: table.filename, mimeType: table.mimeType, sha256: table.sha256 })
      .from(table)
      .where(and(eq(owner, ownerId), inArray(table.id, wanted)))
      .orderBy(...order);
    if (rows.length !== wanted.length) throw fail(`Ein gewählter Anhang gehört nicht ${spec.ofOwner}.`);
    const result: MailAttachment[] = [];
    for (const row of rows) result.push({ filename: row.filename, content: await loadFile(row.sha256), contentType: row.mimeType });
    return result;
  }

  return { list, add, remove, files, copy, attachStored, load, forMail };
}
