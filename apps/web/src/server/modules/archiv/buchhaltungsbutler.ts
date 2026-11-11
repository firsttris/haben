import {
  BuchhaltungsbutlerError,
  DatevParseError,
  previewBuchhaltungsbutlerExport,
  readExportFiles,
  type BuchhaltungsbutlerPreview,
  type BuchhaltungsbutlerVoucher,
  type ExportPart,
} from "@haben/import";
import { and, desc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { sha256Of, storeFile } from "../../storage.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { addArchiveFile, BB_ORIGINAL_NOTE, MAX_ARCHIVE_SIZE } from "./archive.ts";
import { finish, progressMessage, STALE_MS } from "./lexoffice.ts";

export const MAX_BB_EXPORT_SIZE = 500 * 1024 * 1024;
const SOURCE = "buchhaltungsbutler" as const;

export class BuchhaltungsbutlerImportError extends UserError {}

export async function previewBbExport(parts: ExportPart[]) {
  const company = await loadCompany();
  try {
    return previewBuchhaltungsbutlerExport(parts, company.kontenrahmen);
  } catch (error) {
    if (error instanceof BuchhaltungsbutlerError || error instanceof DatevParseError) throw new BuchhaltungsbutlerImportError(error.message);
    throw error;
  }
}

export async function latestBuchhaltungsbutlerImport() {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, SOURCE))
    .orderBy(desc(schema.lexofficeImports.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "laeuft" && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    const [updated] = await db
      .update(schema.lexofficeImports)
      .set({ status: "abgebrochen", error: "Der Import wurde unterbrochen. Ein neuer Import setzt dort fort.", finishedAt: new Date() })
      .where(and(eq(schema.lexofficeImports.id, row.id), eq(schema.lexofficeImports.status, "laeuft")))
      .returning();
    return updated ?? row;
  }
  return row;
}

export async function startBuchhaltungsbutlerImport(actor: string, parts: ExportPart[]) {
  if ((await latestBuchhaltungsbutlerImport())?.status === "laeuft") throw new BuchhaltungsbutlerImportError("Ein BuchhaltungsButler-Import läuft bereits.");
  const preview = await previewBbExport(parts);
  const progress: LexofficeImportProgress = {
    phase: "belege",
    contacts: 0,
    contactsLinked: 0,
    listed: preview.vouchers.length,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
  };
  const [run] = await withActor(actor, (tx) =>
    tx.insert(schema.lexofficeImports).values({ source: SOURCE, progress }).returning({ id: schema.lexofficeImports.id }),
  );
  const importId = run!.id;
  try {
    progress.datevFileIds = await archiveOriginals(actor, parts, preview.year);
    const linkedContacts = new Set<string>();
    for (const item of preview.vouchers) {
      const imported = await importVoucher(actor, importId, item, linkedContacts);
      if (imported) progress.imported += 1;
      else progress.skipped += 1;
      progress.files += imported ? item.files.length : 0;
      progress.contactsLinked = linkedContacts.size;
      if ((progress.imported + progress.skipped) % 20 === 0) {
        await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
      }
    }
    await finish(importId, progress, "fertig", null);
    return { id: importId, ...bbSummary(preview) };
  } catch (error) {
    const message = progressMessage(error);
    await finish(importId, progress, "fehler", message);
    throw error;
  }
}

export function bbSummary(preview: BuchhaltungsbutlerPreview) {
  return {
    year: preview.year,
    dateFrom: preview.dateFrom,
    dateTo: preview.dateTo,
    bookings: preview.bookings,
    vouchers: preview.vouchers.length,
    files: preview.files,
    withoutReceipt: preview.withoutReceipt,
    multipleFiles: preview.multipleFiles,
    warnings: preview.warnings,
  };
}

/**
 * Legt die hochgeladenen Dateien unverändert ab und den erkannten DATEV-Buchungsstapel als DATEV-Datei, auch wenn er
 * aus einer .zip kommt. Liefert die Archivdatei des Stapels, auch eine schon vorhandene (gleiche Prüfsumme).
 */
async function archiveOriginals(actor: string, parts: ExportPart[], year: number): Promise<string[]> {
  const stack = readExportFiles(parts);
  const stackSha = sha256Of(stack.datev);
  const existingId = async (sha256: string) =>
    (await db.select({ id: schema.archiveFiles.id }).from(schema.archiveFiles).where(eq(schema.archiveFiles.sha256, sha256)))[0]?.id;
  for (const part of parts) {
    const sha256 = sha256Of(part.bytes);
    // Der Stapel selbst folgt unten als DATEV-Datei
    if (sha256 === stackSha || (await existingId(sha256))) continue;
    await addArchiveFile(actor, { bytes: part.bytes, filename: part.name, kind: "sonstiges", year, note: BB_ORIGINAL_NOTE }, MAX_BB_EXPORT_SIZE);
  }
  const existing = await existingId(stackSha);
  if (existing) return [existing];
  const added = await addArchiveFile(actor, { bytes: stack.datev, filename: stack.datevName, kind: "datev", year, note: BB_ORIGINAL_NOTE }, MAX_ARCHIVE_SIZE);
  return [added.id];
}

async function importVoucher(actor: string, importId: string, item: BuchhaltungsbutlerVoucher, linkedContacts: Set<string>): Promise<boolean> {
  for (const file of item.files) await storeFile(file.bytes);
  return withActor(actor, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.lexofficeVouchers.id })
      .from(schema.lexofficeVouchers)
      .where(eq(schema.lexofficeVouchers.lexofficeId, item.voucher.lexofficeId));
    if (existing) return false;
    const contactId = await findContact(tx, item.voucher.contactName);
    if (contactId) linkedContacts.add(contactId);
    const v = item.voucher;
    const [row] = await tx
      .insert(schema.lexofficeVouchers)
      .values({
        lexofficeId: v.lexofficeId,
        source: SOURCE,
        importId,
        type: v.type,
        direction: v.direction,
        number: v.number,
        date: v.date,
        dueDate: v.dueDate,
        serviceFrom: v.serviceFrom,
        serviceTo: v.serviceTo,
        status: v.status,
        contactId,
        contactName: v.contactName,
        currency: v.currency,
        net: v.net,
        tax: v.tax,
        gross: v.gross,
        taxes: v.taxes,
        categories: v.categories.map((category) => ({ ...category, name: "" })),
        payment: null,
        remark: v.remark,
        raw: item.raw,
      })
      .returning({ id: schema.lexofficeVouchers.id });
    for (const file of item.files) {
      await tx.insert(schema.lexofficeVoucherFiles).values({
        voucherId: row!.id,
        role: file.role,
        lexofficeFileId: null,
        filename: file.filename.slice(0, 200),
        mimeType: file.role === "xml" ? "application/xml" : "application/pdf",
        sha256: sha256Of(file.bytes),
        size: file.bytes.byteLength,
      });
    }
    return true;
  });
}

async function findContact(tx: Tx, name: string): Promise<string | null> {
  if (!name.trim()) return null;
  const matches = await tx
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(sql`lower(btrim(${schema.contacts.name})) = lower(btrim(${name.trim()}))`)
    .limit(2);
  return matches.length === 1 ? matches[0]!.id : null;
}
