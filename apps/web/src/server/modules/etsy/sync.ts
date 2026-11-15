import { eq } from "drizzle-orm";
import type { EtsyLedgerEntry } from "@haben/import";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { today as todayInGermany } from "../../today.ts";
import { etsyClientFor, EtsyError, loadEtsyConnection, storeEtsySecret } from "./connections.ts";
import { importEtsyLedger, type EtsyImportResult } from "./import.ts";

/*
 * Abruf des Etsy-Zahlungsverlaufs: holt die Zeilen seit dem letzten Anlauf, löst zu Verkäufen und Erstattungen die
 * Bestellnummer nach und übernimmt alles ins Konto des Zahlungsdienstleisters (import.ts).
 *
 * - Der Verlauf ist kein Monatsbericht: Etsy kann Zeilen nachtragen. Deshalb beginnt jeder Abruf drei Tage vor der
 *   jüngsten Zeile des letzten Laufs, nicht an ihr.
 * - Gebühren, Werbung und Steuer eines Monats werden erst gebündelt, wenn der Monat vorbei ist: Etsy ändert die
 *   Gebühren bis zum 2. des Folgemonats, und die Gebührenrechnung entsteht ebenfalls erst dann. Solange ein Monat
 *   läuft, bleiben seine Gebühren liegen (der Abruf sagt das im Ergebnis).
 * - Ein Fehler landet am Zugang (lastError) und im Ergebnis; der nächste Lauf versucht es erneut.
 */

/** Urheber im Protokoll für den automatischen Abruf */
export const ETSY_SYNC_ACTOR = "system:etsyabruf";

/** Der automatische Abruf läuft höchstens so oft; Etsy schreibt laufend, aber nicht im Minutentakt */
const AUTO_SYNC_INTERVAL_MS = 20 * 60 * 60 * 1000;

/** Überlappung in Tagen: Etsy trägt Zeilen nach, die kurz vor dem letzten Abruf entstanden sind */
const OVERLAP_DAYS = 3;

export interface EtsySyncResult {
  /** Zeilen aus dem Verlauf */
  entries: number;
  /** Neu angelegte Umsätze im Konto des Dienstleisters */
  added: number;
  accountName: string | null;
  messages: string[];
  error: string | null;
}

/** Buchungstag einer Zeile, in UTC wie im Parser */
function dayOf(entry: EtsyLedgerEntry): string {
  return new Date((entry.created_timestamp ?? 0) * 1000).toISOString().slice(0, 10);
}

/** Letzter Tag des Vormonats; bis dahin werden Gebühren gebündelt */
function lastDayOfPreviousMonth(now: Date): string {
  const [jahr, monat] = todayInGermany(now).slice(0, 7).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(jahr, monat - 1, 0)).toISOString().slice(0, 10);
}

function minusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function syncEtsy(actor: string, now = new Date()): Promise<EtsySyncResult> {
  const connection = await loadEtsyConnection();
  if (!connection) throw new EtsyError("Der Etsy-Zugang ist nicht eingerichtet (Einstellungen › Bank).");
  if (!connection.secret.refreshToken || !connection.row.shopId) {
    throw new EtsyError("Der Etsy-Zugang ist noch nicht verbunden (Einstellungen › Bank).");
  }
  const result: EtsySyncResult = { entries: 0, added: 0, accountName: null, messages: [], error: null };
  const from = `${connection.row.fetchFrom}T00:00:00Z`;
  const von = Math.floor(new Date(from).getTime() / 1000);
  const bis = Math.floor(now.getTime() / 1000);
  let neuerStart = connection.row.fetchFrom;

  try {
    const client = etsyClientFor(connection, async (tokens) => {
      await storeEtsySecret(actor, { ...connection.secret, ...tokens });
    });
    const entries = await client.ledger(von, bis);
    result.entries = entries.length;
    // Verkauf und Erstattung tragen nur die Zahlungs- bzw. Erstattungsnummer; die Bestellung holt Haben nach
    const kennungen = entries
      .filter((entry) => entry.ledger_type === "PAYMENT_GROSS" || entry.ledger_type === "REFUND_GROSS")
      .map((entry) => entry.reference_id ?? "")
      .filter(Boolean);
    const orders = kennungen.length > 0 ? await client.ordersFor(kennungen) : new Map<string, string>();
    const imported: EtsyImportResult = await importEtsyLedger(actor, entries, {
      orderFor: (referenceId) => orders.get(referenceId),
      sammelzeilen: connection.row.sammelzeilen,
      gebuehrenBis: lastDayOfPreviousMonth(now),
      reference: todayInGermany(now),
    });
    result.added = imported.added;
    result.accountName = imported.accountName;
    result.messages.push(...imported.messages);
    // Der nächste Abruf beginnt vor der jüngsten Zeile, damit nachgetragene Zeilen nicht verloren gehen
    const juengste = entries.map(dayOf).sort().at(-1);
    if (juengste) neuerStart = [minusDays(juengste, OVERLAP_DAYS), connection.row.fetchFrom].sort().at(-1)!;
    await update(actor, { lastSyncAt: now, lastError: null, fetchFrom: neuerStart });
  } catch (error) {
    const meldung = `Abruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    await update(actor, { lastError: meldung, fetchFrom: neuerStart });
    result.error = meldung;
  }
  return result;
}

function update(actor: string, values: Partial<typeof schema.etsyConnections.$inferInsert>) {
  return withActor(actor, (tx) => tx.update(schema.etsyConnections).set(values).where(eq(schema.etsyConnections.id, "etsy")));
}

/** Automatischer Abruf: nur, wenn verbunden und der letzte Anlauf lange genug her ist */
export async function runDueEtsySyncs(now = new Date()): Promise<{ synced: number; added: number; errors: string[] }> {
  const summary = { synced: 0, added: 0, errors: [] as string[] };
  const connection = await loadEtsyConnection();
  if (!connection?.secret.refreshToken || !connection.row.shopId) return summary;
  if (connection.row.lastSyncAt && now.getTime() - connection.row.lastSyncAt.getTime() < AUTO_SYNC_INTERVAL_MS) return summary;
  try {
    const result = await syncEtsy(ETSY_SYNC_ACTOR, now);
    summary.synced = 1;
    summary.added = result.added;
    if (result.error) {
      summary.errors.push(`Etsy Payments: ${result.error}`);
      // Fehlschlag zählt als Abruf, damit der nächste Versuch erst am nächsten Tag kommt
      await update(ETSY_SYNC_ACTOR, { lastSyncAt: now });
    }
  } catch (error) {
    summary.errors.push(`Etsy Payments: ${error instanceof Error ? error.message : String(error)}`);
  }
  return summary;
}
