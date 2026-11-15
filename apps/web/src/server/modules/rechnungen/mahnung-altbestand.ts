import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Mahnstufe einer aus der bisherigen Buchhaltung übernommenen Rechnung, gelesen aus den archivierten Mahnungen
 * (legacy_dunnings, geschrieben vom Umzug im Modul archiv). Es entsteht keine Mahnung in Haben: Das Mahnwesen schlägt
 * nur die nächste Stufe passend vor und lässt keine niedrigere zu.
 *
 * sevDesk zählt laut OpenAPI die versendeten Mahnungen, „Starts with 1 (Payment reminder)“
 * (https://api.sevdesk.de/openapi.yaml, Invoice.dunningLevel). Stufe 1 entspricht damit der Zahlungserinnerung, Stufe 2
 * der 1. Mahnung. Ob eine höhere Stufe in sevDesk schon die letzte Mahnung war, ist nicht belegt; sie zählt deshalb
 * wie Stufe 2, und Haben schlägt danach die letzte Mahnung vor.
 */

export interface ImportedDunning {
  /** Stufe in Haben: 1 Zahlungserinnerung, 2 Mahnung */
  level: 1 | 2;
  /** Stufe in der Quelle */
  sourceLevel: number;
  source: string;
  date: string;
  dueDate: string | null;
  /** PDF der Mahnung im Archiv */
  fileId: string | null;
}

/** Höchste archivierte Mahnstufe je Rechnung in Haben; nur Rechnungen, die aus dem Altbestand übernommen sind */
export async function importedDunnings(invoiceIds: string[], q: Db | Tx = db): Promise<Map<string, ImportedDunning>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await q
    .select({
      invoiceId: schema.invoices.id,
      sourceLevel: schema.legacyDunnings.level,
      source: schema.legacyDunnings.source,
      date: schema.legacyDunnings.date,
      dueDate: schema.legacyDunnings.dueDate,
      fileId: sql<string | null>`(select f.id from legacy_dunning_files f where f.dunning_id = ${schema.legacyDunnings.id} order by f.created_at limit 1)`,
    })
    .from(schema.invoices)
    .innerJoin(schema.lexofficeVouchers, eq(schema.lexofficeVouchers.id, schema.invoices.lexofficeVoucherId))
    .innerJoin(
      schema.legacyDunnings,
      and(eq(schema.legacyDunnings.invoiceExternalId, schema.lexofficeVouchers.lexofficeId), eq(schema.legacyDunnings.source, schema.lexofficeVouchers.source)),
    )
    .where(and(inArray(schema.invoices.id, invoiceIds), isNotNull(schema.legacyDunnings.level)));
  const out = new Map<string, ImportedDunning>();
  for (const row of rows) {
    const known = out.get(row.invoiceId);
    const sourceLevel = row.sourceLevel!;
    if (known && (known.sourceLevel > sourceLevel || (known.sourceLevel === sourceLevel && known.date >= row.date))) continue;
    out.set(row.invoiceId, { ...row, sourceLevel, level: sourceLevel >= 2 ? 2 : 1 });
  }
  return out;
}
