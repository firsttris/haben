import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { today as todayInGermany } from "../../today.ts";
import { abrufFaellig, dayOf, type EtsyRhythmus, gebuehrenBisAm, laenderHinweis, naechsterAbrufStart } from "./abruf-regeln.ts";
import { etsyClientFor, EtsyError, loadEtsyConnection, storeEtsySecret } from "./connections.ts";
import { importEtsyLedger, type EtsyImportResult } from "./import.ts";

/*
 * Abruf des Etsy-Zahlungsverlaufs: holt die Zeilen seit dem letzten Anlauf, löst zu Verkäufen und Erstattungen die
 * Bestellnummer und das Land des Käufers nach und übernimmt alles ins Konto des Zahlungsdienstleisters (import.ts).
 *
 * - Der Verlauf ist kein Monatsbericht: Etsy kann Zeilen nachtragen. Deshalb beginnt jeder Abruf drei Tage vor der
 *   jüngsten Zeile des letzten Laufs, höchstens aber am 1. des ersten noch nicht gebündelten Monats (abruf-regeln.ts).
 * - Gebühren und Werbung eines Monats werden erst ab dem 5. des Folgemonats gebündelt: Etsy korrigiert die Gebühren bis
 *   dahin noch nachträglich. Bis dahin bleiben sie liegen (der Abruf sagt das im Ergebnis); Sammelzeilen, die schon im
 *   Konto stehen, entstehen nicht ein zweites Mal.
 * - Ein Fehler landet am Zugang (lastError) und im Ergebnis; der nächste Lauf versucht es erneut.
 */

/** Urheber im Protokoll für den automatischen Abruf */
export const ETSY_SYNC_ACTOR = "system:etsyabruf";

export interface EtsySyncResult {
  /** Zeilen aus dem Verlauf */
  entries: number;
  /** Neu angelegte Umsätze im Konto des Dienstleisters */
  added: number;
  accountName: string | null;
  messages: string[];
  error: string | null;
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
    // Verkauf und Erstattung tragen nur die Zahlungs- bzw. Erstattungsnummer; die Bestellung holt Haben nach.
    // Etsy will dabei die Kennung der Verlaufszeile (entry_id), nicht die Nummer aus reference_id.
    const verlaufsKennungen = entries
      .filter((entry) => entry.ledger_type === "PAYMENT_GROSS" || entry.ledger_type === "REFUND_GROSS")
      .map((entry) => (entry.entry_id === undefined ? "" : String(entry.entry_id)))
      .filter(Boolean);
    const orders = verlaufsKennungen.length > 0 ? await client.ordersFor(verlaufsKennungen) : new Map<string, string>();
    // Das Land des Käufers entscheidet die Steuer der Rechnung (DE 19 %, USA nicht steuerbar, übrige klären). Gefragt
    // wird nur für Verkäufe und Erstattungen seit dem letzten Abruf (ein Tag Luft), nicht bei jedem Lauf für den ganzen Monat
    const seit = connection.row.lastSyncAt ? connection.row.lastSyncAt.getTime() / 1000 - 24 * 60 * 60 : 0;
    const neueZahlungen = new Set(
      entries
        .filter((entry) => (entry.ledger_type === "PAYMENT_GROSS" || entry.ledger_type === "REFUND_GROSS") && (entry.created_timestamp ?? 0) >= seit)
        .map((entry) => String(entry.reference_id ?? "")),
    );
    const bestellungen = [...new Set([...neueZahlungen].map((id) => orders.get(id)).filter((id): id is string => Boolean(id)))];
    const laender = bestellungen.length > 0 ? await client.countriesFor(bestellungen) : new Map<string, string>();
    const gebuehrenBis = gebuehrenBisAm(todayInGermany(now));
    const imported: EtsyImportResult = await importEtsyLedger(actor, entries, {
      orderFor: (referenceId) => orders.get(referenceId),
      sammelzeilen: connection.row.sammelzeilen,
      gebuehrenBis,
      reference: todayInGermany(now),
    });
    result.added = imported.added;
    result.accountName = imported.accountName;
    result.messages.push(...imported.messages);
    const hinweis = laenderHinweis(bestellungen, laender);
    if (hinweis) result.messages.push(hinweis);
    neuerStart = naechsterAbrufStart(entries.map(dayOf), connection.row.fetchFrom, gebuehrenBis);
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
  const letzter = connection.row.lastSyncAt
    ? { zeit: connection.row.lastSyncAt, tag: todayInGermany(connection.row.lastSyncAt), fehlgeschlagen: connection.row.lastError !== null }
    : null;
  if (!abrufFaellig(connection.row.rhythmus as EtsyRhythmus, letzter, now, todayInGermany(now))) return summary;
  try {
    const result = await syncEtsy(ETSY_SYNC_ACTOR, now);
    summary.synced = 1;
    summary.added = result.added;
    if (result.error) {
      summary.errors.push(`Etsy Payments: ${result.error}`);
      // Fehlschlag zählt als Anlauf; der nächste Versuch kommt nach einem Tag (abrufFaellig)
      await update(ETSY_SYNC_ACTOR, { lastSyncAt: now });
    }
  } catch (error) {
    summary.errors.push(`Etsy Payments: ${error instanceof Error ? error.message : String(error)}`);
  }
  return summary;
}
