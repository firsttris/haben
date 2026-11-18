import { randomBytes } from "node:crypto";
import { addDays } from "@haben/core";
import { type VividClient, type VividClientOptions, vividAbruf, vividClient, vividEventOf, VIVID_PROVIDER, vividZugangAbgelehnt } from "@haben/import";
import { eq, isNotNull } from "drizzle-orm";
import { BankError } from "./bank.ts";
import { AUTO_SYNC_INTERVAL_MS, BANK_SYNC_ACTOR, lastFileBooking } from "./bank-sync.ts";
import { recordRefusedBatch, storeBatch } from "./import-batch.ts";
import { berlinTimestamp } from "./vertrag-abruf.ts";
import { decrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { env } from "../../env.ts";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { sha256Of } from "../../storage.ts";
import { today as todayInGermany } from "../../today.ts";

/*
 * Kontoabruf über die Vivid Business API (#1393): je Konto alle Umsätze, die Vivid herausgibt, als Lieferung des
 * Importvertrags (#306) speichern. Vivid gibt nur die letzten 90 Tage heraus und filtert nicht nach Tag; jeder Abruf liest
 * deshalb das ganze Fenster und erkennt Schon-Abgerufenes an der id. So kommt auch eine Vormerkung an, die erst nach
 * Tagen gebucht wird: Ihr Tag bleibt der Tag der Kartenzahlung.
 */

/** Vivid: „from 00:00 UTC 90 days before the day of the request“; ein Tag Abstand für die Zeitzone */
const HISTORY_DAYS = 89;

let clientFactory = (options: VividClientOptions): VividClient => vividClient({ baseUrl: env().VIVID_API_URL || undefined, ...options });

/** Für Tests: Client gegen eine nachgestellte API */
export function setVividClientFactory(factory: (options: VividClientOptions) => VividClient): void {
  clientFactory = factory;
}

export function vividClientFor(apiKey: string): VividClient {
  return clientFactory({ apiKey });
}

/**
 * Erster Tag des Abrufs: nicht vor den 90 Tagen, die Vivid herausgibt, nicht in Tage, die eine Datei oder ein anderer
 * Abrufweg schon abdeckt (sonst stünde dieselbe Zahlung mit anderem Verwendungszweck zweimal da), nicht vor „Umsätze abrufen
 * ab“. Beim ersten Abruf ohne gewählten Tag ab Jahresbeginn. `gekappt`: Der gewünschte Beginn lag vor den 90 Tagen.
 */
export function vividStart(
  account: Pick<BankConnectionAccount, "syncedTo" | "fetchFrom">,
  lastOther: string | null,
  today: string,
): { from: string; gekappt: string | null } {
  const frueheste = addDays(today, -HISTORY_DAYS);
  const gewuenscht = [account.fetchFrom ?? (account.syncedTo ? null : `${today.slice(0, 4)}-01-01`), lastOther ? addDays(lastOther, 1) : null]
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  if (gewuenscht && gewuenscht > today) return { from: today, gekappt: null };
  if (gewuenscht && gewuenscht >= frueheste) return { from: gewuenscht, gekappt: null };
  return { from: frueheste, gekappt: !account.syncedTo && gewuenscht ? gewuenscht : null };
}

export interface VividErgebnis {
  ok: boolean;
  meldung: string;
  hinweise: string[];
  neu: number;
}

const umsaetze = (n: number) => `${n} ${n === 1 ? "neuer Umsatz" : "neue Umsätze"}`;

/** Ruft alle Konten einer Verbindung ab. Fehler stehen im Ergebnis und an der Verbindung. */
export async function vividAbrufen(actor: string, id: string, now = new Date(), einleitung = "Vivid"): Promise<VividErgebnis> {
  const today = todayInGermany(now);
  const [connection] = await db.select().from(schema.vividConnections).where(eq(schema.vividConnections.id, id));
  if (!connection) throw new BankError("Verbindung nicht gefunden.");
  const update = (values: Partial<typeof schema.vividConnections.$inferInsert>) =>
    withActor(actor, (tx) => tx.update(schema.vividConnections).set(values).where(eq(schema.vividConnections.id, id)));
  const api = vividClientFor(decrypt(connection.ciphertext).toString("utf8"));
  // Ausgeschlossene Konten (#462) gehören nicht zu dieser Firma: kein Abruf, die anderen laufen weiter
  const excluded = new Set(
    (await db.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(isNotNull(schema.bankAccounts.excludedAt))).map((r) => r.id),
  );
  const accounts = [...connection.accounts];
  const hinweise: string[] = [];
  const konflikte: string[] = [];
  let neu = 0;
  try {
    const bekannt = new Map((await api.accounts()).map((a) => [a.id, a]));
    for (const [i, account] of accounts.entries()) {
      if (excluded.has(account.bankAccountId)) continue;
      const konto = bekannt.get(account.uid);
      if (!konto) {
        konflikte.push(`${account.name}: Vivid nennt das Konto nicht mehr (geschlossen oder für diesen Schlüssel nicht sichtbar).`);
        continue;
      }
      const { from, gekappt } = vividStart(account, await lastFileBooking(account.bankAccountId, "vivid"), today);
      if (gekappt)
        hinweise.push(`${account.name}: Vivid gibt nur die letzten 90 Tage heraus; Umsätze vom ${gekappt} bis vor dem ${from} per Datei importieren.`);
      const transactions = await api.transactions(account.uid);
      const fetchId = randomBytes(8).toString("hex");
      const { batch, statement } = vividAbruf({ account: konto, transactions, dateFrom: from, dateTo: today, fetchedAt: berlinTimestamp(now), fetchId });
      const input = {
        batch,
        binding: { provider: VIVID_PROVIDER, externalAccountId: account.uid, accountKind: "bank" as const },
        statement,
        eventOf: vividEventOf,
        source: { filename: `Vivid-Abruf ${today}`, sha256: sha256Of(Buffer.from(JSON.stringify(transactions), "utf8")) },
      };
      try {
        const stored = await withActor(actor, (tx) => storeBatch(tx, input, account.bankAccountId));
        neu += stored.added;
        if (stored.gap) hinweise.push(stored.gap);
        if (stored.quelle) hinweise.push(stored.quelle);
        accounts[i] = { ...account, syncedTo: today };
      } catch (error) {
        // Ein Konflikt hält nur dieses Konto an; gespeichert ist von diesem Abruf nichts außer der Meldung im Importprotokoll
        if (!(error instanceof BankError)) throw error;
        await withActor(actor, (tx) => recordRefusedBatch(tx, account.bankAccountId, input, error.message));
        konflikte.push(`${account.name}: ${error.message}`);
      }
    }
  } catch (error) {
    const meldung = `Abruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    // Abgelehnter Schlüssel: Der Hintergrund versucht es nicht wieder, bis jemand einen neuen einträgt
    await update({ accounts, lastError: meldung, ...(vividZugangAbgelehnt(error) ? { status: "fehler" as const } : {}) });
    return { ok: false, meldung, hinweise, neu };
  }
  const fehler = konflikte.length > 0 ? konflikte.join(" ") : null;
  await update({ accounts, lastSyncAt: now, lastError: fehler, status: "aktiv" });
  return { ok: fehler === null, meldung: fehler ?? `${einleitung}: ${umsaetze(neu)}.`, hinweise, neu };
}

/**
 * Abruf im Hintergrund (Scheduler, je Verbindung höchstens alle 20 Stunden): aktive Verbindungen. Ein Fehlschlag zählt als
 * Versuch, damit der nächste erst am nächsten Tag kommt; nach „fehler“ wartet die Verbindung auf einen neuen Schlüssel.
 */
export async function runDueVividSyncs(now = new Date()): Promise<{ synced: number; added: number; errors: string[] }> {
  const summary = { synced: 0, added: 0, errors: [] as string[] };
  const rows = await db
    .select({ id: schema.vividConnections.id, lastSyncAt: schema.vividConnections.lastSyncAt })
    .from(schema.vividConnections)
    .where(eq(schema.vividConnections.status, "aktiv"));
  for (const row of rows) {
    if (row.lastSyncAt && now.getTime() - row.lastSyncAt.getTime() < AUTO_SYNC_INTERVAL_MS) continue;
    try {
      const result = await vividAbrufen(BANK_SYNC_ACTOR, row.id, now);
      summary.synced++;
      summary.added += result.neu;
      if (!result.ok) {
        summary.errors.push(`Vivid: ${result.meldung}`);
        await withActor(BANK_SYNC_ACTOR, (tx) => tx.update(schema.vividConnections).set({ lastSyncAt: now }).where(eq(schema.vividConnections.id, row.id)));
      }
    } catch (error) {
      summary.errors.push(`Vivid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
