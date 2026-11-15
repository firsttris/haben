import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Zahlungsbezüge übernommener Journalpakete, nur lesend: EÜR (euer-import.ts) und Jahresarchiv brauchen sie. Geschrieben
 * werden sie in datenimport/external-settlement-store.ts; gelesen wird hier, weil auswertungen unter datenimport steht.
 */

/** Alle Teilzahlungen der im Zeitraum ausgeglichenen Posten, einschließlich früherer Jahre für die Cent-Reste. */
export async function externalSettlementLinks(q: Db | Tx, importIds: string[]) {
  const s = schema.externalImportSettlements;
  const targets = new Set<string>();
  for (let i = 0; i < importIds.length; i += 5000)
    for (const r of await q
      .select({ id: s.originalImportId })
      .from(s)
      .where(inArray(s.paymentImportId, importIds.slice(i, i + 5000))))
      targets.add(r.id);
  const payment = schema.externalImports;
  const original = alias(schema.externalImports, "original_import");
  const originalJournal = alias(schema.journalEntries, "original_journal");
  const rows: { record: typeof s.$inferSelect; paymentId: string; originalId: string; externalId: string; originalExternalId: string; source: string }[] = [];
  const ids = [...targets];
  for (let i = 0; i < ids.length; i += 5000)
    rows.push(
      ...(await q
        .select({
          record: s,
          paymentId: schema.journalEntries.id,
          originalId: originalJournal.id,
          externalId: payment.externalId,
          originalExternalId: original.externalId,
          source: payment.source,
        })
        .from(s)
        .innerJoin(payment, eq(payment.id, s.paymentImportId))
        .innerJoin(original, eq(original.id, s.originalImportId))
        .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, payment.entryId))
        .innerJoin(originalJournal, eq(originalJournal.id, original.entryId))
        .where(inArray(s.originalImportId, ids.slice(i, i + 5000)))),
    );
  return rows;
}
