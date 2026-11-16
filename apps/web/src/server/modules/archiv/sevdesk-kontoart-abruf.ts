import { SevdeskApiError, type SevdeskClient } from "@haben/import";
import { sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { ohneJit } from "../../db/ohne-jit.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { progressMessage } from "./lexoffice.ts";
import { sevdeskPositionAccount, sevdeskPositions } from "./sevdesk-kategorie.ts";

/*
 * Kontostamm der Buchungskonten aus sevDesk (#472): Zu jeder archivierten Gutschrift mit `bookingCategory` ACCOUNTING_TYPE
 * und zu jedem Konto einer Beleg-Position, auch aus früheren Läufen, holt der Abruf GET /AccountingType/{id}, je Konto
 * einmal, und legt die Antwort unverändert ab. Den Pfad nennt die OpenAPI nur im Abschnitt „Accounting type“ (Tag Voucher,
 * „Use this in sevdesk-Update 1.0“), nicht unter den Pfaden; Konten aus Positionen fragt der Abruf deshalb nur in
 * Buchhaltungsversion 1.0 ab. Eine Position mit `accountDatev` (2.0) zählt nach diesem Konto, nicht nach `accountingType`
 * (wie mapSevVoucher). Ein gleicher Stand kommt nicht doppelt (eindeutig über ID und Hash der Antwort). Die Art einer
 * Gutschrift liest sevdesk-kontoart.ts, die Kategorie einer Position sevdesk-kategorie.ts.
 */
export async function importSevdeskAccountingTypes(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const [connection] = await db.select({ version: schema.sevdeskConnection.bookkeepingVersion }).from(schema.sevdeskConnection);
  const positions = connection?.version !== "2.0";
  // Über alle Positionen aller Belege: Die Schätzung läge bei vielen Belegen über den Schwellen des JIT (ohne-jit.ts)
  const rows = await ohneJit((tx) =>
    tx.execute<{ id: string }>(sql`
    select distinct id from (
      select v.raw->'accountingType'->>'id' as id from lexoffice_vouchers v
      where v.source = 'sevdesk' and v.lexoffice_id like 'creditnote/%' and upper(coalesce(v.raw->>'bookingCategory', '')) = 'ACCOUNTING_TYPE'
      union all
      select ${sevdeskPositionAccount("p.value")} from lexoffice_vouchers v, ${sevdeskPositions("v")} p
      where ${positions} and v.source = 'sevdesk'
    ) ids
    where coalesce(id, '') <> ''
    order by 1`),
  );
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
