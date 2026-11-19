import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { abrufFaellig, abrufFenster, naechsterAbrufStart, type PayPalRhythmus } from "./abruf-regeln.ts";
import { loadPayPalConnection, PayPalError, paypalClientFor } from "./connections.ts";
import { importPayPal } from "./import.ts";

/*
 * Abruf der Transaction Search von PayPal: holt die Transaktionen seit dem letzten Anlauf und übernimmt sie ins Konto des
 * Zahlungsdienstleisters (import.ts).
 *
 * - Der erste Abruf beginnt am gewählten Starttag, jeder weitere zehn Tage vor dem Tag des letzten erfolgreichen Abrufs, nie
 *   davor (abruf-regeln.ts); schon übernommene Bewegungen erkennt Haben an ihrer Kennung. Liegt eine ausstehende Zahlung
 *   zurück, beginnt er an deren Tag (höchstens 45 Tage zurück), damit sie ankommt, sobald PayPal sie abschließt.
 * - Ein Fehler landet am Zugang (lastError) und im Ergebnis; der nächste Lauf versucht es erneut.
 * - Ohne Konto des Dienstleisters ist nichts gespeichert: Der Startpunkt bleibt, sonst holte kein späterer Abruf diese Umsätze mehr.
 */

/** Urheber im Protokoll für den automatischen Abruf */
export const PAYPAL_SYNC_ACTOR = "system:paypalabruf";

export interface PayPalSyncResult {
  /** Zeilen aus dem Abruf (mit dem Spielraum, den der Client am Rand mitholt) */
  entries: number;
  /** Neu angelegte Umsätze im Konto des Dienstleisters */
  added: number;
  accountName: string | null;
  messages: string[];
  error: string | null;
}

let laufend: Promise<PayPalSyncResult> | null = null;

/**
 * Ein Abruf zur Zeit: Zeitplan und „Jetzt abrufen“ können zusammenfallen. Läuft schon einer, bekommt der zweite
 * dessen Ergebnis, statt dieselben Umsätze gleichzeitig anzulegen.
 */
export function syncPayPal(actor: string, now = new Date()): Promise<PayPalSyncResult> {
  if (laufend) return laufend;
  laufend = syncPayPalEinmal(actor, now).finally(() => {
    laufend = null;
  });
  return laufend;
}

async function syncPayPalEinmal(actor: string, now: Date): Promise<PayPalSyncResult> {
  const connection = await loadPayPalConnection();
  if (!connection) throw new PayPalError("Der PayPal-Zugang ist nicht eingerichtet (Einstellungen › Bank).");
  const result: PayPalSyncResult = { entries: 0, added: 0, accountName: null, messages: [], error: null };
  const { dateFrom, dateTo } = abrufFenster(connection.row.fetchFrom, now);
  let neuerStart = dateFrom;
  try {
    const transactions = await paypalClientFor(connection.credentials).transactions(dateFrom, dateTo);
    result.entries = transactions.length;
    const imported = await importPayPal(actor, transactions, { accountId: connection.row.accountId, zone: connection.row.zeitzone, dateFrom, dateTo, now });
    result.added = imported.added;
    result.accountName = imported.accountName;
    result.messages.push(...imported.messages);
    if (imported.accountName !== null) neuerStart = naechsterAbrufStart(dateFrom, now, imported.offenSeit);
    await update(actor, { lastSyncAt: now, lastError: null, fetchFrom: neuerStart });
  } catch (error) {
    const meldung = `Abruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    await update(actor, { lastError: meldung, fetchFrom: neuerStart });
    result.error = meldung;
  }
  return result;
}

function update(actor: string, values: Partial<typeof schema.paypalConnections.$inferInsert>) {
  return withActor(actor, (tx) => tx.update(schema.paypalConnections).set(values).where(eq(schema.paypalConnections.id, "paypal")));
}

/** Automatischer Abruf: nur, wenn eingerichtet und der letzte Anlauf lange genug her ist */
export async function runDuePayPalSyncs(now = new Date()): Promise<{ synced: number; added: number; messages: string[]; errors: string[] }> {
  const summary = { synced: 0, added: 0, messages: [] as string[], errors: [] as string[] };
  const connection = await loadPayPalConnection();
  if (!connection) return summary;
  const letzter = connection.row.lastSyncAt ? { zeit: connection.row.lastSyncAt, fehlgeschlagen: connection.row.lastError !== null } : null;
  if (!abrufFaellig(connection.row.rhythmus as PayPalRhythmus, letzter, now)) return summary;
  try {
    const result = await syncPayPal(PAYPAL_SYNC_ACTOR, now);
    summary.synced = 1;
    summary.added = result.added;
    summary.messages.push(...result.messages);
    if (result.error) {
      summary.errors.push(`PayPal: ${result.error}`);
      // Fehlschlag zählt als Anlauf; der nächste Versuch kommt nach einem Tag (abrufFaellig)
      await update(PAYPAL_SYNC_ACTOR, { lastSyncAt: now });
    }
  } catch (error) {
    summary.errors.push(`PayPal: ${error instanceof Error ? error.message : String(error)}`);
  }
  return summary;
}
