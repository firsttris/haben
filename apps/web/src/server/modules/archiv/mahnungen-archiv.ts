import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Lesen der archivierten Mahnungen (legacy_dunnings). Verbunden mit der gemahnten Rechnung über deren Kennung in der
 * Quelle (lexoffice_vouchers.lexoffice_id); Belegansicht, Rechnungsseite und Mahnwesen lesen von hier.
 */

export type LegacyDunningRow = Awaited<ReturnType<typeof legacyDunningsFor>>[number];

/** Mahnungen je gemahnter Rechnung, nach Stufe und Datum; mit ihren Dateien */
export async function legacyDunningsFor(invoiceExternalIds: string[]) {
  if (invoiceExternalIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.legacyDunnings.id,
      invoiceExternalId: schema.legacyDunnings.invoiceExternalId,
      source: schema.legacyDunnings.source,
      level: schema.legacyDunnings.level,
      number: schema.legacyDunnings.number,
      date: schema.legacyDunnings.date,
      dueDate: schema.legacyDunnings.dueDate,
      sentDate: schema.legacyDunnings.sentDate,
      status: schema.legacyDunnings.status,
      currency: schema.legacyDunnings.currency,
      total: schema.legacyDunnings.total,
    })
    .from(schema.legacyDunnings)
    .where(inArray(schema.legacyDunnings.invoiceExternalId, invoiceExternalIds))
    .orderBy(asc(schema.legacyDunnings.level), asc(schema.legacyDunnings.date), asc(schema.legacyDunnings.externalId));
  if (rows.length === 0) return [];
  const files = await db
    .select({
      id: schema.legacyDunningFiles.id,
      dunningId: schema.legacyDunningFiles.dunningId,
      filename: schema.legacyDunningFiles.filename,
      mimeType: schema.legacyDunningFiles.mimeType,
      size: schema.legacyDunningFiles.size,
    })
    .from(schema.legacyDunningFiles)
    .where(
      inArray(
        schema.legacyDunningFiles.dunningId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({ ...r, files: files.filter((f) => f.dunningId === r.id).map(({ dunningId: _, ...f }) => f) }));
}

export async function legacyDunningFile(fileId: string) {
  const [file] = await db.select().from(schema.legacyDunningFiles).where(eq(schema.legacyDunningFiles.id, fileId));
  return file ?? null;
}
