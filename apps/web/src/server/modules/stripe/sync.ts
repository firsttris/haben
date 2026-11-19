import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { abrufFaellig, naechsterAbrufStart, type StripeRhythmus, utcDay } from "./abruf-regeln.ts";
import { loadStripeConnection, StripeError, stripeClientFor } from "./connections.ts";
import { importStripe } from "./import.ts";

/*
 * Abruf der Balance Transactions von Stripe: holt sie seit dem letzten Anlauf und übernimmt sie ins Konto des
 * Zahlungsdienstleisters (import.ts).
 *
 * - Der erste Abruf beginnt am gewählten Starttag, jeder weitere drei Tage vor dem Tag des letzten erfolgreichen Abrufs, nie davor (abruf-regeln.ts); schon übernommene
 *   Bewegungen erkennt Haben an ihrer Kennung.
 * - Ein Fehler landet am Zugang (lastError) und im Ergebnis; der nächste Lauf versucht es erneut.
 * - Ohne Konto des Dienstleisters ist nichts gespeichert: Der Startpunkt bleibt, sonst holte kein späterer Abruf diese Umsätze mehr.
 */

/** Urheber im Protokoll für den automatischen Abruf */
export const STRIPE_SYNC_ACTOR = "system:stripeabruf";

export interface StripeSyncResult {
  /** Balance Transactions aus dem Abruf */
  entries: number;
  /** Neu angelegte Umsätze im Konto des Dienstleisters */
  added: number;
  accountName: string | null;
  messages: string[];
  error: string | null;
}

let laufend: Promise<StripeSyncResult> | null = null;

/**
 * Ein Abruf zur Zeit: Zeitplan und „Jetzt abrufen“ können zusammenfallen. Läuft schon einer, bekommt der zweite
 * dessen Ergebnis, statt dieselben Umsätze gleichzeitig anzulegen.
 */
export function syncStripe(actor: string, now = new Date()): Promise<StripeSyncResult> {
  if (laufend) return laufend;
  laufend = syncStripeEinmal(actor, now).finally(() => {
    laufend = null;
  });
  return laufend;
}

async function syncStripeEinmal(actor: string, now: Date): Promise<StripeSyncResult> {
  const connection = await loadStripeConnection();
  if (!connection) throw new StripeError("Der Stripe-Zugang ist nicht eingerichtet (Einstellungen › Bank).");
  const result: StripeSyncResult = { entries: 0, added: 0, accountName: null, messages: [], error: null };
  const dateTo = utcDay(now);
  // Der gewählte Start ist ein Tag in Deutschland, das Fenster läuft in UTC: Zwischen 0 und 2 Uhr deutscher Zeit liegt der
  // Start „heute“ hinter dem Ende des Fensters, und der Importvertrag lehnte die Lieferung ab
  const dateFrom = [connection.row.fetchFrom, dateTo].sort()[0]!;
  let neuerStart = connection.row.fetchFrom;
  try {
    const client = stripeClientFor(connection.apiKey);
    const transactions = await client.balanceTransactions(dateFrom, dateTo);
    result.entries = transactions.length;
    if (client.ohneZahlungsdetails) {
      result.messages.push(
        "Der Schlüssel erlaubt Stripe nicht, Zahlungen aufzuklappen: Name des Kunden und Bezug von Erstattungen fehlen. Die Umsätze sind vollständig; mit zusätzlichem Lesezugriff (etwa auf Zahlungen und Erstattungen) kommen die Angaben dazu.",
      );
    }
    const imported = await importStripe(actor, transactions, { accountId: connection.row.accountId, dateFrom, dateTo, now });
    result.added = imported.added;
    result.accountName = imported.accountName;
    result.messages.push(...imported.messages);
    if (imported.accountName !== null) neuerStart = naechsterAbrufStart(connection.row.fetchFrom, now);
    await update(actor, { lastSyncAt: now, lastError: null, fetchFrom: neuerStart });
  } catch (error) {
    const meldung = `Abruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    await update(actor, { lastError: meldung, fetchFrom: neuerStart });
    result.error = meldung;
  }
  return result;
}

function update(actor: string, values: Partial<typeof schema.stripeConnections.$inferInsert>) {
  return withActor(actor, (tx) => tx.update(schema.stripeConnections).set(values).where(eq(schema.stripeConnections.id, "stripe")));
}

/** Automatischer Abruf: nur, wenn eingerichtet und der letzte Anlauf lange genug her ist */
export async function runDueStripeSyncs(now = new Date()): Promise<{ synced: number; added: number; messages: string[]; errors: string[] }> {
  const summary = { synced: 0, added: 0, messages: [] as string[], errors: [] as string[] };
  const connection = await loadStripeConnection();
  if (!connection) return summary;
  const letzter = connection.row.lastSyncAt ? { zeit: connection.row.lastSyncAt, fehlgeschlagen: connection.row.lastError !== null } : null;
  if (!abrufFaellig(connection.row.rhythmus as StripeRhythmus, letzter, now)) return summary;
  try {
    const result = await syncStripe(STRIPE_SYNC_ACTOR, now);
    summary.synced = 1;
    summary.added = result.added;
    summary.messages.push(...result.messages);
    if (result.error) {
      summary.errors.push(`Stripe: ${result.error}`);
      // Fehlschlag zählt als Anlauf; der nächste Versuch kommt nach einem Tag (abrufFaellig)
      await update(STRIPE_SYNC_ACTOR, { lastSyncAt: now });
    }
  } catch (error) {
    summary.errors.push(`Stripe: ${error instanceof Error ? error.message : String(error)}`);
  }
  return summary;
}
