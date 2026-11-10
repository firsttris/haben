import { addReportMonths, reportMonthsBetween } from "@haben/import";
import { eq } from "drizzle-orm";
import { archiveFetchedFile } from "../archiv/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { Store } from "../../db/schema.ts";
import { storeFile } from "../../storage.ts";
import { today as todayInGermany } from "../../today.ts";
import { importStoreReports, type StoreImportResult } from "./import.ts";
import { appStoreClientFor, googlePlayClientFor, loadConnection, STORE_LABELS, StoreError } from "./connections.ts";

/*
 * Abruf der Finanzberichte: lädt jeden fertigen Monatsbericht, der noch nicht in store_reports steht, und legt ihn
 * unverändert ins Archiv (GoBD: Originaldatei, 10 Jahre) und übernimmt danach alle Berichte, die noch nicht im
 * Zahlungsdienstleister-Konto des Stores stehen (import.ts).
 *
 * - Google Play listet die Berichte im Bucket; was dort liegt, ist fertig. Ein Monat kann aus mehreren Dateien bestehen.
 * - App Store Connect hat keine Liste: Haben fragt je Fiskalmonat ab fetch_from bis zum Vormonat. Kein Bericht (404)
 *   heißt „noch nicht abgerechnet“ oder „keine Verkäufe“; Monate, die länger als drei Monate ohne Bericht bleiben,
 *   fragt Haben nicht mehr ab (Apple stellt Berichte bis zum ersten Freitag des Folgemonats bereit).
 */

/** Urheber im Protokoll für den automatischen Abruf */
export const STORE_SYNC_ACTOR = "system:storeabruf";

/** Der automatische Abruf läuft höchstens so oft; neue Berichte gibt es einmal im Monat */
const AUTO_SYNC_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** So lange fragt Haben bei Apple einen Monat ohne Bericht noch nach */
const APPLE_GRACE_MONTHS = 3;

export interface StoreSyncResult {
  /** Neu archivierte Berichte */
  added: { period: string; part: string; filename: string }[];
  error: string | null;
  /** Übernahme ins Konto des Stores nach dem Abruf */
  imported: StoreImportResult;
}

interface FetchedReport {
  period: string;
  part: string;
  filename: string;
  bytes: Uint8Array;
}

async function knownParts(store: Store): Promise<Set<string>> {
  const rows = await db
    .select({ period: schema.storeReports.period, part: schema.storeReports.part })
    .from(schema.storeReports)
    .where(eq(schema.storeReports.store, store));
  return new Set(rows.map((r) => `${r.period} ${r.part}`));
}

/** Schreibt die Datei und trägt Archiv und Bericht in einer Transaktion ein; ein gleichzeitiger zweiter Abruf ändert nichts */
async function saveReport(actor: string, store: Store, report: FetchedReport): Promise<boolean> {
  const sha256 = await storeFile(report.bytes);
  return withActor(actor, async (tx) => {
    const archiveFileId = await archiveFetchedFile(tx, {
      bytes: report.bytes,
      sha256,
      filename: report.filename,
      kind: "storebericht",
      year: Number(report.period.slice(0, 4)),
      note: `${STORE_LABELS[store]}, Finanzbericht ${report.period}`,
      meta: { store, period: report.period, part: report.part },
    });
    const inserted = await tx
      .insert(schema.storeReports)
      .values({
        store,
        reportKind: store === "googleplay" ? "earnings" : "finance_detail",
        part: report.part,
        period: report.period,
        sha256,
        archiveFileId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.storeReports.id });
    return inserted.length > 0;
  });
}

/** Ruft die fehlenden Berichte eines Stores ab. Fehler stehen im Ergebnis und am Zugang. */
export async function syncStore(actor: string, store: Store, now = new Date()): Promise<StoreSyncResult> {
  const connection = await loadConnection(store);
  if (!connection) throw new StoreError(`Der Abruf für ${STORE_LABELS[store]} ist nicht eingerichtet (Einstellungen › Bank).`);
  const result: StoreSyncResult = { added: [], error: null, imported: { accountName: null, added: 0, drafts: 0, messages: [] } };
  const from = connection.fetchFrom.slice(0, 7);
  const currentMonth = todayInGermany(now).slice(0, 7);
  const lastMonth = addReportMonths(currentMonth, -1);
  let fetchFrom = connection.fetchFrom;

  const record = async (report: FetchedReport) => {
    if (await saveReport(actor, store, report)) result.added.push({ period: report.period, part: report.part, filename: report.filename });
  };

  try {
    const known = await knownParts(store);
    const { config, secret } = connection;
    if (config.store === "googleplay") {
      const api = googlePlayClientFor(config, secret);
      for (const object of await api.listEarnings()) {
        if (object.month < from || known.has(`${object.month} ${object.name}`)) continue;
        await record({ period: object.month, part: object.name, filename: object.name.split("/").pop()!, bytes: await api.download(object.name) });
      }
    } else if (config.store === "appstore") {
      const api = appStoreClientFor(config, secret);
      const missing: string[] = [];
      for (const month of reportMonthsBetween(from, lastMonth)) {
        if (known.has(`${month} Z1`)) continue;
        const bytes = await api.financeDetail(month);
        if (bytes) await record({ period: month, part: "Z1", filename: `apple_finance_detail_Z1_${config.vendorNumber}_${month}.txt.gz`, bytes });
        else missing.push(month);
      }
      const cutoff = addReportMonths(currentMonth, -APPLE_GRACE_MONTHS);
      const open = missing.find((month) => month >= cutoff);
      // Ältere Monate ohne Bericht gelten als ohne Verkäufe; der nächste Abruf beginnt beim ersten noch offenen
      const next = open ?? addReportMonths(lastMonth, 1);
      if (next > from) fetchFrom = `${next}-01`;
    }
    await update(actor, store, { lastSyncAt: now, lastError: null, fetchFrom });
  } catch (error) {
    const message = `Abruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    await update(actor, store, { lastError: message, fetchFrom });
    result.error = message;
  }
  // Auch nach einem Fehler: schon archivierte Berichte, etwa nach dem Anlegen des Kontos
  result.imported = await importStoreReports(actor, store);
  return result;
}

function update(actor: string, store: Store, values: Partial<typeof schema.storeConnections.$inferInsert>) {
  return withActor(actor, (tx) => tx.update(schema.storeConnections).set(values).where(eq(schema.storeConnections.store, store)));
}

/** Automatischer Abruf: alle Zugänge, deren letzter Abruf lange genug her ist */
export async function runDueStoreSyncs(now = new Date()): Promise<{ synced: number; added: number; errors: string[] }> {
  const summary = { synced: 0, added: 0, errors: [] as string[] };
  const connections = await db.select({ store: schema.storeConnections.store, lastSyncAt: schema.storeConnections.lastSyncAt }).from(schema.storeConnections);
  for (const connection of connections) {
    if (connection.lastSyncAt && now.getTime() - connection.lastSyncAt.getTime() < AUTO_SYNC_INTERVAL_MS) continue;
    try {
      const result = await syncStore(STORE_SYNC_ACTOR, connection.store, now);
      summary.synced++;
      summary.added += result.added.length;
      if (result.error) {
        summary.errors.push(`${STORE_LABELS[connection.store]}: ${result.error}`);
        // Fehlschlag zählt als Abruf, damit der nächste Versuch erst am nächsten Tag kommt
        await update(STORE_SYNC_ACTOR, connection.store, { lastSyncAt: now });
      }
    } catch (error) {
      summary.errors.push(`${STORE_LABELS[connection.store]}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
