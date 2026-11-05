import { and, asc, eq, inArray } from "drizzle-orm";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { withActor } from "../../db/actor.ts";
import { fileInUse } from "../../db/file-in-use.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadFile, removeFile, sniff, storeFile } from "../../storage.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";
import { InvoiceError, lockDraft } from "./invoices.ts";

/**
 * Zusätzliche Anhänge an Ausgangsrechnungen (#272): PDF-Dateien wie Stundenzettel oder Leistungsnachweise, die mit der
 * Rechnung verschickt werden. Hinzufügen und Entfernen nur im Entwurf; beim Festschreiben sperrt die Datenbank sie mit
 * der Rechnung (invoice_attachments_locked, 0123). Die Dateien liegen wie Belege unter ihrem SHA-256 im
 * Dokumentenspeicher (storage.ts). PDF und XML der Rechnung bleiben unverändert.
 */

export type InvoiceAttachment = Pick<typeof schema.invoiceAttachments.$inferSelect, "id" | "filename" | "size" | "sha256" | "createdAt">;

/** Was gegen die Datei als Anhang spricht, oder null; Typ am Inhalt erkannt, Grenze wie bei Belegen */
export function attachmentFileProblem(file: { bytes: Uint8Array; filename: string }): string | null {
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

export async function listInvoiceAttachments(invoiceId: string, q: Db | Tx = db): Promise<InvoiceAttachment[]> {
  return q
    .select({
      id: schema.invoiceAttachments.id,
      filename: schema.invoiceAttachments.filename,
      size: schema.invoiceAttachments.size,
      sha256: schema.invoiceAttachments.sha256,
      createdAt: schema.invoiceAttachments.createdAt,
    })
    .from(schema.invoiceAttachments)
    .where(eq(schema.invoiceAttachments.invoiceId, invoiceId))
    .orderBy(asc(schema.invoiceAttachments.createdAt), asc(schema.invoiceAttachments.id));
}

/**
 * Hängt eine PDF-Datei an einen Entwurf. Dieselbe Datei ein zweites Mal liefert den vorhandenen Anhang. Die Datei wird
 * vor der Transaktion abgelegt; scheitert diese, bleibt sie unter ihrem Hash liegen, wie bei Belegen ohne Schaden.
 */
export async function addInvoiceAttachment(
  actor: string,
  invoiceId: string,
  file: { bytes: Uint8Array; filename: string },
): Promise<{ id: string; duplicate: boolean }> {
  const problem = attachmentFileProblem(file);
  if (problem) throw new InvoiceError(problem);
  const sha256 = await storeFile(file.bytes);
  return withActor(actor, async (tx) => {
    await lockDraft(tx, invoiceId);
    const existing = await listInvoiceAttachments(invoiceId, tx);
    const same = existing.find((a) => a.sha256 === sha256);
    if (same) return { id: same.id, duplicate: true };
    if (existing.length >= MAX_INVOICE_ATTACHMENTS) throw new InvoiceError(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Anhänge je Rechnung.`);
    const [created] = await tx
      .insert(schema.invoiceAttachments)
      .values({ invoiceId, filename: attachmentFilename(file.filename), mimeType: "application/pdf", sha256, size: file.bytes.byteLength })
      .returning({ id: schema.invoiceAttachments.id });
    return { id: created!.id, duplicate: false };
  });
}

/** Entfernt einen Anhang aus dem Entwurf; die Datei geht mit, solange sie sonst niemand nutzt */
export async function removeInvoiceAttachment(actor: string, invoiceId: string, attachmentId: string): Promise<void> {
  const unused = await withActor(actor, async (tx) => {
    await lockDraft(tx, invoiceId);
    const [removed] = await tx
      .delete(schema.invoiceAttachments)
      .where(and(eq(schema.invoiceAttachments.id, attachmentId), eq(schema.invoiceAttachments.invoiceId, invoiceId)))
      .returning({ sha256: schema.invoiceAttachments.sha256 });
    if (!removed) throw new InvoiceError("Anhang nicht gefunden.");
    return unusedFiles(tx, [removed.sha256]);
  });
  await removeFiles(unused);
}

/** Dateien der Anhänge einer Rechnung, bevor sie gelöscht wird (Entwurf löschen) */
export async function attachmentFiles(tx: Tx, invoiceId: string): Promise<string[]> {
  return (await listInvoiceAttachments(invoiceId, tx)).map((a) => a.sha256);
}

/** Welche der Dateien nach dem Löschen niemand mehr nutzt; in derselben Transaktion fragen */
export async function unusedFiles(tx: Tx, hashes: string[]): Promise<string[]> {
  const unused: string[] = [];
  for (const sha256 of new Set(hashes)) if (!(await fileInUse(tx, sha256))) unused.push(sha256);
  return unused;
}

/** Nach dem Commit: nicht mehr genutzte Dateien aus dem Speicher nehmen */
export async function removeFiles(hashes: string[]): Promise<void> {
  for (const sha256 of hashes) await removeFile(sha256);
}

/** Datei eines Anhangs zum Herunterladen, auch nach dem Festschreiben */
export async function loadInvoiceAttachment(id: string): Promise<{ filename: string; mimeType: string; bytes: Buffer } | null> {
  const [row] = await db
    .select({ filename: schema.invoiceAttachments.filename, mimeType: schema.invoiceAttachments.mimeType, sha256: schema.invoiceAttachments.sha256 })
    .from(schema.invoiceAttachments)
    .where(eq(schema.invoiceAttachments.id, id));
  if (!row) return null;
  return { filename: row.filename, mimeType: row.mimeType, bytes: await loadFile(row.sha256) };
}

/** Die ausgewählten Anhänge für die E-Mail, in der Reihenfolge an der Rechnung; fremde Anhänge lehnt Haben ab */
export async function attachmentsForMail(invoiceId: string, ids: string[]): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ filename: schema.invoiceAttachments.filename, mimeType: schema.invoiceAttachments.mimeType, sha256: schema.invoiceAttachments.sha256 })
    .from(schema.invoiceAttachments)
    .where(and(eq(schema.invoiceAttachments.invoiceId, invoiceId), inArray(schema.invoiceAttachments.id, wanted)))
    .orderBy(asc(schema.invoiceAttachments.createdAt), asc(schema.invoiceAttachments.id));
  if (rows.length !== wanted.length) throw new InvoiceError("Ein gewählter Anhang gehört nicht zu dieser Rechnung.");
  const files: { filename: string; content: Buffer; contentType: string }[] = [];
  for (const row of rows) files.push({ filename: row.filename, content: await loadFile(row.sha256), contentType: row.mimeType });
  return files;
}
