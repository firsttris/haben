import { SevdeskApiError, type SevdeskClient } from "@haben/import";
import { sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Kontostamm der Buchungskonten aus sevDesk (#472): Zu jeder archivierten Gutschrift mit `bookingCategory` ACCOUNTING_TYPE,
 * auch aus früheren Läufen, holt der Abruf GET /AccountingType/{id} und legt die Antwort unverändert ab. Den Pfad nennt die
 * OpenAPI nur im Abschnitt „Accounting type“ (Tag Voucher, „Use this in sevdesk-Update 1.0“), nicht unter den Pfaden.
 * Ein gleicher Stand kommt nicht doppelt (eindeutig über ID und Hash der Antwort). Die Art liest sevdesk-kontoart.ts.
 */
export async function importSevdeskAccountingTypes(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const rows = await db.execute<{ id: string }>(sql`
    select distinct v.raw->'accountingType'->>'id' as id from lexoffice_vouchers v
    where v.source = 'sevdesk' and v.lexoffice_id like 'creditnote/%' and upper(coalesce(v.raw->>'bookingCategory', '')) = 'ACCOUNTING_TYPE'
      and coalesce(v.raw->'accountingType'->>'id', '') <> ''
    order by 1`);
  for (const { id } of rows) {
    try {
      const raw = await client.accountingType(id);
      await withActor(actor, (tx) =>
        tx
          .insert(schema.sevdeskAccountingTypes)
          .values({ importId, accountingTypeId: id, raw: raw as Record<string, unknown> })
          .onConflictDoNothing(),
      );
    } catch (error) {
      if (signal.aborted || (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403))) throw error;
      progress.failed.push({
        lexofficeId: `accountingtype/${id}`,
        number: `Buchungskonto ${id}`,
        message: `Buchungskonto nicht abgerufen: ${progressMessage(error)}`,
      });
    }
  }
}
