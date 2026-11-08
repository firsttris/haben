import { asc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";
import { attachmentFileProblem, removeFiles, storeAttachmentFile, unusedFiles, type Attachment, type AttachmentFile } from "./attachment-store.ts";
import { QuoteError } from "./quotes.ts";

/**
 * Standardanhänge für Angebote (#415): AGB, Widerrufsbelehrung und Ähnliches einmal in den Einstellungen. Jedes neue
 * Angebot bekommt sie beim Anlegen als eigene Anhänge (quotes.ts, createQuoteDraft); dort sind sie beim Senden
 * vorausgewählt, im Entwurf abwählbar und mit dem Festschreiben gesperrt. Ändert sich die Einstellung, bleiben
 * bestehende Angebote, wie sie sind. Prüfung und Ablage der Datei wie bei allen Anhängen (attachment-store.ts).
 */

const t = schema.quoteDefaultAttachments;

export async function listQuoteDefaultAttachments(q: Db | Tx = db): Promise<Attachment[]> {
  return q.select({ id: t.id, filename: t.filename, size: t.size, sha256: t.sha256, createdAt: t.createdAt }).from(t).orderBy(asc(t.createdAt), asc(t.id));
}

/** Hinterlegt eine PDF-Datei; dieselbe Datei ein zweites Mal liefert den vorhandenen Eintrag */
export async function addQuoteDefaultAttachment(actor: string, file: AttachmentFile): Promise<{ id: string; duplicate: boolean }> {
  const problem = attachmentFileProblem(file);
  if (problem) throw new QuoteError(problem);
  return withActor(actor, async (tx) => {
    // Gleichzeitiges Hinzufügen nacheinander, sonst überschreiten zwei zusammen die Höchstzahl
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('haben-standardanhaenge', 0))`);
    const stored = await storeAttachmentFile(tx, file);
    const existing = await listQuoteDefaultAttachments(tx);
    const same = existing.find((a) => a.sha256 === stored.sha256);
    if (same) return { id: same.id, duplicate: true };
    if (existing.length >= MAX_INVOICE_ATTACHMENTS) throw new QuoteError(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Standardanhänge.`);
    const [created] = await tx
      .insert(t)
      .values({ ...stored, mimeType: "application/pdf" })
      .returning({ id: t.id });
    return { id: created!.id, duplicate: false };
  });
}

/** Nimmt einen Standardanhang aus den Einstellungen; Angebote, die ihn schon haben, behalten ihn samt Datei */
export async function removeQuoteDefaultAttachment(actor: string, id: string): Promise<void> {
  const unused = await withActor(actor, async (tx) => {
    const [removed] = await tx.delete(t).where(eq(t.id, id)).returning({ sha256: t.sha256 });
    if (!removed) throw new QuoteError("Anhang nicht gefunden.");
    return unusedFiles(tx, [removed.sha256]);
  });
  await removeFiles(unused);
}

/** Datei eines Standardanhangs zum Ansehen und Herunterladen */
export async function loadQuoteDefaultAttachment(id: string): Promise<{ filename: string; mimeType: string; bytes: Buffer } | null> {
  const [row] = await db.select({ filename: t.filename, mimeType: t.mimeType, sha256: t.sha256 }).from(t).where(eq(t.id, id));
  if (!row) return null;
  return { filename: row.filename, mimeType: row.mimeType, bytes: await loadFile(row.sha256) };
}
