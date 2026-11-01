import { createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  EnableBankingApiError,
  EnableBankingClient,
  enableBankingStatement,
  type Aspsp,
  type EnableBankingClientOptions,
} from "@haben/import";
import { and, desc, eq, gt, inArray, max, ne } from "drizzle-orm";
import { z } from "zod";
import { accountForIban, BankError, storeStatement, type ImportResult } from "./bank.ts";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { env } from "../../env.ts";
import { sha256Of } from "../../storage.ts";
import { today as todayInGermany } from "../../today.ts";

/** Urheber im Protokoll für den nächtlichen Abruf */
export const BANK_SYNC_ACTOR = "system:bankabruf";

/** Längste Zustimmung nach PSD2; viele Banken erlauben 180 Tage */
const MAX_CONSENT_DAYS = 180;
/** Folgeabrufe überlappen, damit spät gebuchte Umsätze nicht verloren gehen; Doppelte erkennt der Hash */
const OVERLAP_DAYS = 7;
/** Ohne vorhandene Umsätze: ab Jahresbeginn, und wenn die Bank das ablehnt, die letzten 89 Tage */
const FALLBACK_HISTORY_DAYS = 89;
/** Der automatische Abruf läuft höchstens so oft (PSD2 erlaubt ohne Nutzer etwa vier Abrufe am Tag) */
const AUTO_SYNC_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** So lange gilt die Rückleitung der Bank nach dem Start der Verbindung */
const STATE_MAX_AGE_MS = 60 * 60 * 1000;
/** Hinweis zum Erneuern der Zustimmung so viele Tage vor Ablauf */
export const RENEW_WARNING_DAYS = 14;

const DAY = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Bankliste je Land, zwischengespeichert; ein neuer Zugang leert sie */
let bankCache: { country: string; at: number; banks: Aspsp[] } | null = null;

/** Zugang aus der Umgebung (ENABLE_BANKING_APP_ID mit ENABLE_BANKING_KEY oder ENABLE_BANKING_KEY_FILE) */
function envCredentials(): { applicationId: string; privateKey: string } | null {
  const e = env();
  if (!e.ENABLE_BANKING_APP_ID) return null;
  let privateKey = e.ENABLE_BANKING_KEY?.replace(/\\n/g, "\n");
  if (!privateKey && e.ENABLE_BANKING_KEY_FILE) privateKey = readFileSync(e.ENABLE_BANKING_KEY_FILE, "utf8");
  return privateKey ? { applicationId: e.ENABLE_BANKING_APP_ID, privateKey } : null;
}

async function loadSettingsRow() {
  const [row] = await db.select().from(schema.enableBankingSettings).where(eq(schema.enableBankingSettings.id, 1));
  return row ?? null;
}

/** Zugangsdaten der Enable-Banking-Anwendung: zuerst aus den Einstellungen, sonst aus der Umgebung; null, wenn nicht eingerichtet */
async function credentials(): Promise<{ applicationId: string; privateKey: string } | null> {
  const row = await loadSettingsRow();
  if (row) return { applicationId: row.applicationId, privateKey: decrypt(row.ciphertext).toString("utf8") };
  return envCredentials();
}

export async function enableBankingConfigured(): Promise<boolean> {
  try {
    return (await credentials()) !== null;
  } catch {
    return false;
  }
}

/** Für die Einstellungen: woher der Zugang kommt, ohne den Schlüssel */
export async function enableBankingSettingsSummary() {
  const row = await loadSettingsRow();
  let fromEnv: string | null;
  try {
    fromEnv = envCredentials()?.applicationId ?? null;
  } catch {
    // Schlüsseldatei nicht lesbar: gilt als nicht eingerichtet
    fromEnv = null;
  }
  return {
    source: row ? ("einstellungen" as const) : fromEnv ? ("umgebung" as const) : null,
    applicationId: row?.applicationId ?? fromEnv,
    updatedAt: row?.updatedAt ?? null,
    callbackUrl: callbackUrl(),
  };
}

export const enableBankingSettingsSchema = z.object({
  applicationId: z.string().trim().min(1, "Application ID fehlt").max(100).regex(/^[A-Za-z0-9-]+$/, "Nur die Application ID, z. B. aus dem Dateinamen der .pem"),
  /** leer: den gespeicherten Schlüssel behalten */
  privateKey: z.string().max(20_000).optional(),
});

/** Prüft den Schlüssel und den Zugang bei Enable Banking und speichert beides verschlüsselt. */
export async function saveEnableBankingSettings(actor: string, input: z.input<typeof enableBankingSettingsSchema>): Promise<void> {
  const data = enableBankingSettingsSchema.parse(input);
  const existing = await loadSettingsRow();
  const pem = data.privateKey?.trim() ? data.privateKey.trim() + "\n" : existing ? decrypt(existing.ciphertext).toString("utf8") : null;
  if (!pem) throw new BankError("Der private Schlüssel (.pem) fehlt.");
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") throw new Error(`erwartet RSA, nicht ${key.asymmetricKeyType}`);
  } catch (error) {
    throw new BankError(`Der Schlüssel ist keine gültige .pem-Datei von Enable Banking: ${apiMessage(error)}`);
  }
  try {
    await clientFactory({ applicationId: data.applicationId, privateKey: pem, baseUrl: env().ENABLE_BANKING_API_URL }).aspsps("DE");
  } catch (error) {
    throw new BankError(`Enable Banking lehnt den Zugang ab: ${apiMessage(error)}. Passen Application ID und Schlüssel zusammen?`);
  }
  const values = { applicationId: data.applicationId, ciphertext: encrypt(new TextEncoder().encode(pem)), updatedAt: new Date() };
  await withActor(actor, (tx) =>
    tx.insert(schema.enableBankingSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: schema.enableBankingSettings.id, set: values }),
  );
  bankCache = null;
}

/** Entfernt den Zugang aus den Einstellungen; ein Zugang aus der Umgebung gilt danach wieder. */
export async function deleteEnableBankingSettings(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.enableBankingSettings).where(eq(schema.enableBankingSettings.id, 1)));
  bankCache = null;
}

/** Rückleitung nach der Freigabe bei der Bank; muss in der Enable-Banking-Anwendung eingetragen sein */
export function callbackUrl(): string {
  return `${env().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/bank/callback`;
}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: EnableBankingClientOptions) => new EnableBankingClient(options);

export function setEnableBankingClientFactory(factory: (options: EnableBankingClientOptions) => EnableBankingClient) {
  clientFactory = factory;
}

async function client(): Promise<EnableBankingClient> {
  let creds;
  try {
    creds = await credentials();
  } catch (error) {
    throw new BankError(`Der Schlüssel für Enable Banking ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!creds) throw new BankError("Der automatische Abruf ist nicht eingerichtet (Einstellungen › Bank).");
  return clientFactory({ ...creds, baseUrl: env().ENABLE_BANKING_API_URL });
}

function apiMessage(error: unknown): string {
  if (error instanceof EnableBankingApiError || error instanceof BankError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Banken eines Landes, eine Stunde zwischengespeichert */
export async function listBanks(country = "DE") {
  if (!bankCache || bankCache.country !== country || Date.now() - bankCache.at > 60 * 60 * 1000) {
    try {
      bankCache = { country, at: Date.now(), banks: await (await client()).aspsps(country) };
    } catch (error) {
      throw new BankError(`Bankliste nicht abrufbar: ${apiMessage(error)}`);
    }
  }
  return bankCache.banks
    .map((bank) => ({
      name: bank.name,
      country: bank.country,
      logo: bank.logo ?? null,
      psuTypes: bank.psu_types ?? ["personal"],
      maxConsentDays: Math.min(MAX_CONSENT_DAYS, Math.floor((bank.maximum_consent_validity ?? MAX_CONSENT_DAYS * 86_400) / 86_400)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * Startet die Verbindung: Enable Banking liefert die Adresse der Bank, dort meldet sich der Nutzer an
 * und gibt die Konten frei. Danach leitet die Bank auf /api/bank/callback zurück.
 */
export async function startConnection(actor: string, input: { aspspName: string; country: string; psuType: "personal" | "business" }): Promise<{ url: string }> {
  const bank = (await listBanks(input.country)).find((b) => b.name === input.aspspName);
  if (!bank) throw new BankError("Diese Bank bietet Enable Banking nicht an.");
  const psuType = bank.psuTypes.includes(input.psuType) ? input.psuType : (bank.psuTypes[0] as "personal" | "business");
  const validUntil = new Date(Date.now() + bank.maxConsentDays * DAY);
  const state = randomBytes(24).toString("base64url");
  let url: string;
  try {
    ({ url } = await (await client()).startAuthorization({
      aspsp: { name: bank.name, country: bank.country },
      validUntil,
      redirectUrl: callbackUrl(),
      state,
      psuType,
    }));
  } catch (error) {
    throw new BankError(`Die Verbindung konnte nicht gestartet werden: ${apiMessage(error)}`);
  }
  await withActor(actor, async (tx) => {
    // Abgebrochene Versuche aufräumen
    await tx.delete(schema.bankConnections).where(eq(schema.bankConnections.status, "wartet"));
    await tx.insert(schema.bankConnections).values({ aspspName: bank.name, aspspCountry: bank.country, psuType, state, validUntil });
  });
  return { url };
}

/**
 * Rückleitung der Bank: Sitzung anlegen, Konten über die IBAN zuordnen (fehlende werden angelegt)
 * und gleich den ersten Abruf starten. Eine neue Zustimmung für ein schon verbundenes Konto löst die
 * alte ab und übernimmt deren Abrufstand.
 */
export async function completeConnection(
  actor: string,
  input: { state: string; code?: string; error?: string; errorDescription?: string },
): Promise<{ connectionId: string; ok: boolean; message: string }> {
  // state atomar verbrauchen: ein zweiter Aufruf mit demselben Wert findet nichts mehr
  const [connection] = await withActor(actor, (tx) =>
    tx
      .update(schema.bankConnections)
      .set({ state: null })
      .where(
        and(
          eq(schema.bankConnections.state, input.state),
          eq(schema.bankConnections.status, "wartet"),
          gt(schema.bankConnections.createdAt, new Date(Date.now() - STATE_MAX_AGE_MS)),
        ),
      )
      .returning(),
  );
  if (!connection) throw new BankError("Unbekannte, abgelaufene oder schon verwendete Freigabe. Bitte erneut verbinden.");

  if (!input.code) {
    const message = input.errorDescription || input.error || "Die Bank hat die Freigabe nicht erteilt.";
    await withActor(actor, (tx) =>
      tx.update(schema.bankConnections).set({ status: "fehler", lastError: message }).where(eq(schema.bankConnections.id, connection.id)),
    );
    return { connectionId: connection.id, ok: false, message };
  }

  let session;
  try {
    session = await (await client()).createSession(input.code);
  } catch (error) {
    const message = `Die Bank hat die Freigabe nicht bestätigt: ${apiMessage(error)}`;
    await withActor(actor, (tx) =>
      tx.update(schema.bankConnections).set({ status: "fehler", lastError: message }).where(eq(schema.bankConnections.id, connection.id)),
    );
    return { connectionId: connection.id, ok: false, message };
  }

  // Haben bucht nur in Euro: Fremdwährungskonten nicht abrufen. Manche Banken (z. B. Finom) führen ein USD-Unterkonto
  // unter derselben IBAN wie ein Euro-Konto; über die IBAN landete es sonst im selben Konto.
  const euro = (a: (typeof session.accounts)[number]) => !a.currency || a.currency.toUpperCase() === "EUR";
  const withIban = session.accounts.filter((a) => a.account_id?.iban && euro(a));
  const foreign = session.accounts.filter((a) => a.account_id?.iban && !euro(a)).map((a) => a.currency!.toUpperCase());
  const skipped = session.accounts.length - withIban.length - foreign.length;
  const replaced: { id: string; sessionId: string | null }[] = [];
  const created: string[] = [];

  await withActor(actor, async (tx) => {
    // Auch abgelaufene Zustimmungen ablösen, sonst stünde das Konto doppelt in der Liste
    const others = await tx
      .select()
      .from(schema.bankConnections)
      .where(and(inArray(schema.bankConnections.status, ["aktiv", "abgelaufen", "fehler"]), ne(schema.bankConnections.id, connection.id)));
    const accounts: BankConnectionAccount[] = [];
    for (const account of withIban) {
      const iban = account.account_id!.iban!.replace(/\s/g, "").toUpperCase();
      const [known] = await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, iban));
      // Bankname vorweg und die letzten vier IBAN-Ziffern dahinter: zwei Konten derselben Bank bleiben unterscheidbar
      const name = `${connection.aspspName}${account.name ? ` ${account.name}` : ""} …${iban.slice(-4)}`.slice(0, 100);
      const bankAccount = await accountForIban(tx, iban, name);
      if (!known) created.push(bankAccount.name);
      const previous = others.flatMap((o) => o.accounts).find((a) => a.bankAccountId === bankAccount.id);
      accounts.push({ uid: account.uid, iban, name: bankAccount.name, bankAccountId: bankAccount.id, syncedTo: previous?.syncedTo ?? null });
    }
    const ids = new Set(accounts.map((a) => a.bankAccountId));
    for (const other of others) {
      const remaining = other.accounts.filter((a) => !ids.has(a.bankAccountId));
      if (remaining.length === other.accounts.length) continue;
      if (remaining.length === 0) {
        replaced.push({ id: other.id, sessionId: other.ciphertext ? decrypt(other.ciphertext).toString("utf8") : null });
        await tx.delete(schema.bankConnections).where(eq(schema.bankConnections.id, other.id));
      } else {
        await tx.update(schema.bankConnections).set({ accounts: remaining }).where(eq(schema.bankConnections.id, other.id));
      }
    }
    await tx
      .update(schema.bankConnections)
      .set({
        status: accounts.length > 0 ? "aktiv" : "fehler",
        ciphertext: encrypt(Buffer.from(session.session_id, "utf8")),
        validUntil: session.access?.valid_until ? new Date(session.access.valid_until) : connection.validUntil,
        accounts,
        lastError: accounts.length > 0 ? null : "Die Bank hat kein Konto mit IBAN freigegeben.",
      })
      .where(eq(schema.bankConnections.id, connection.id));
  });

  // Abgelöste Zustimmungen auch bei Enable Banking beenden; schlägt das fehl, laufen sie einfach aus
  for (const old of replaced) {
    if (old.sessionId) await (await client()).deleteSession(old.sessionId).catch(() => undefined);
  }

  if (withIban.length === 0) return { connectionId: connection.id, ok: false, message: "Die Bank hat kein Konto mit IBAN freigegeben." };
  const sync = await syncConnection(actor, connection.id);
  const note =
    (created.length > 0 ? ` Neu angelegt: ${created.join(", ")}. Name und Zweck (z. B. Steuerkonto) legst du unter Bank mit „Name und Zweck“ fest.` : "") +
    (skipped > 0 ? ` ${skipped} Konten ohne IBAN (z. B. Kreditkarten) werden nicht abgerufen.` : "") +
    (foreign.length > 0 ? ` ${foreign.length} Konten in Fremdwährung (${[...new Set(foreign)].join(", ")}) werden nicht abgerufen, Haben bucht nur in Euro.` : "");
  return { connectionId: connection.id, ok: sync.error === null, message: (sync.error ?? `${connection.aspspName} verbunden, ${sync.added} neue Umsätze.`) + note };
}

/**
 * Beginn eines Folgeabrufs: sieben Tage vor dem letzten Abruf, aber nicht in Tage, die schon eine Datei abdeckt.
 * Sonst kämen deren Umsätze mit dem anders formatierten Verwendungszweck der API ein zweites Mal (wie beim
 * ersten Abruf, siehe syncStart). Reicht die Datei über heute hinaus, ab heute.
 */
export function followUpStart(syncedTo: string, lastFileBooking: string | null, today: string): string {
  const overlap = addDays(syncedTo, -OVERLAP_DAYS);
  const afterFile = lastFileBooking ? addDays(lastFileBooking, 1) : null;
  if (!afterFile || afterFile <= overlap) return overlap;
  return afterFile > today ? today : afterFile;
}

/** Letzter Buchungstag aus einem Dateiimport (nicht aus dem Abruf) */
async function lastFileBooking(bankAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ date: max(schema.bankTransactions.bookingDate) })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankImports, eq(schema.bankImports.id, schema.bankTransactions.importId))
    .where(and(eq(schema.bankTransactions.bankAccountId, bankAccountId), ne(schema.bankImports.format, "enablebanking")));
  return row?.date ?? null;
}

/** Erster Tag des Abrufs für ein Konto */
async function syncStart(account: BankConnectionAccount, today: string): Promise<{ from: string; fallback: string | null }> {
  if (account.syncedTo) return { from: followUpStart(account.syncedTo, await lastFileBooking(account.bankAccountId), today), fallback: null };
  // Schon per Datei importierte Umsätze nicht noch einmal holen: die Bank formatiert den Verwendungszweck
  // in der API oft anders als in der CSV, dann würden die Hashes nicht passen.
  const [latest] = await db
    .select({ date: max(schema.bankTransactions.bookingDate) })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.bankAccountId, account.bankAccountId));
  if (latest?.date) return { from: addDays(latest.date, 1), fallback: null };
  return { from: `${today.slice(0, 4)}-01-01`, fallback: addDays(today, -FALLBACK_HISTORY_DAYS) };
}

export interface SyncResult {
  added: number;
  accounts: (ImportResult & { iban: string })[];
  error: string | null;
}

/** Ruft die Umsätze aller Konten einer Verbindung ab. Fehler stehen im Ergebnis und an der Verbindung. */
export async function syncConnection(actor: string, connectionId: string, today = todayInGermany()): Promise<SyncResult> {
  const [connection] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, connectionId));
  if (!connection) throw new BankError("Verbindung nicht gefunden.");
  if (connection.status !== "aktiv" || !connection.ciphertext) throw new BankError("Die Verbindung ist nicht aktiv. Bitte die Zustimmung erneuern.");

  const update = (values: Partial<typeof schema.bankConnections.$inferInsert>) =>
    withActor(actor, (tx) => tx.update(schema.bankConnections).set(values).where(eq(schema.bankConnections.id, connectionId)));

  if (connection.validUntil && connection.validUntil.getTime() <= Date.now()) {
    const message = "Die Zustimmung ist abgelaufen. Bitte bei der Bank erneuern.";
    await update({ status: "abgelaufen", lastError: message });
    return { added: 0, accounts: [], error: message };
  }

  const api = await client();
  const result: SyncResult = { added: 0, accounts: [], error: null };
  const accounts = [...connection.accounts];
  try {
    for (const [i, account] of accounts.entries()) {
      const { from, fallback } = await syncStart(account, today);
      let dateFrom = from;
      let transactions;
      try {
        transactions = await api.transactions(account.uid, dateFrom, today);
      } catch (error) {
        // Manche Banken geben ohne frische Anmeldung nur 90 Tage heraus
        if (!fallback || !(error instanceof EnableBankingApiError) || error.status < 400 || error.status >= 500 || error.status === 401 || error.status === 403) throw error;
        dateFrom = fallback;
        transactions = await api.transactions(account.uid, dateFrom, today);
      }
      const balances = await api.balances(account.uid).catch(() => []);
      const statement = enableBankingStatement({
        account: { uid: account.uid, account_id: { iban: account.iban }, name: account.name },
        transactions,
        balances,
        dateFrom,
        dateTo: today,
      });
      const stored = await withActor(actor, (tx) =>
        storeStatement(
          tx,
          statement,
          { filename: `Abruf ${connection.aspspName} ${today}`, sha256: sha256Of(Buffer.from(JSON.stringify(transactions), "utf8")) },
          account.bankAccountId,
        ),
      );
      result.accounts.push({ ...stored, iban: account.iban });
      result.added += stored.added;
      accounts[i] = { ...account, syncedTo: today };
    }
    await update({ accounts, lastSyncAt: new Date(), lastError: null });
  } catch (error) {
    const message = `Abruf fehlgeschlagen: ${apiMessage(error)}`;
    const expired = error instanceof EnableBankingApiError && (error.status === 401 || error.status === 403);
    await update({ accounts, lastError: message, ...(expired ? { status: "abgelaufen" as const } : {}) });
    result.error = expired ? `${message}. Die Zustimmung ist vermutlich abgelaufen oder widerrufen; bitte erneuern.` : message;
  }
  return result;
}

/** Nächtlicher Abruf: alle aktiven Verbindungen, deren letzter Abruf lange genug her ist */
export async function runDueBankSyncs(now = new Date()): Promise<{ synced: number; added: number; errors: string[] }> {
  const summary = { synced: 0, added: 0, errors: [] as string[] };
  if (!(await enableBankingConfigured())) return summary;
  const connections = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.status, "aktiv"));
  for (const connection of connections) {
    if (connection.lastSyncAt && now.getTime() - connection.lastSyncAt.getTime() < AUTO_SYNC_INTERVAL_MS) continue;
    try {
      const result = await syncConnection(BANK_SYNC_ACTOR, connection.id, todayInGermany(now));
      summary.synced++;
      summary.added += result.added;
      if (result.error) {
        summary.errors.push(`${connection.aspspName}: ${result.error}`);
        // Fehlschlag zählt als Abruf, damit der nächste Versuch erst am nächsten Tag kommt
        await withActor(BANK_SYNC_ACTOR, (tx) => tx.update(schema.bankConnections).set({ lastSyncAt: now }).where(eq(schema.bankConnections.id, connection.id)));
      }
    } catch (error) {
      summary.errors.push(`${connection.aspspName}: ${apiMessage(error)}`);
    }
  }
  return summary;
}

/** Verbindungen für die Bankseite, ohne Sitzungskennung */
export async function listConnections() {
  const rows = await db
    .select({
      id: schema.bankConnections.id,
      aspspName: schema.bankConnections.aspspName,
      psuType: schema.bankConnections.psuType,
      status: schema.bankConnections.status,
      validUntil: schema.bankConnections.validUntil,
      accounts: schema.bankConnections.accounts,
      lastSyncAt: schema.bankConnections.lastSyncAt,
      lastError: schema.bankConnections.lastError,
      createdAt: schema.bankConnections.createdAt,
    })
    .from(schema.bankConnections)
    .orderBy(desc(schema.bankConnections.createdAt));
  // Namen wie unter Bank: umbenannte Konten nicht mit dem Namen vom Verbinden zeigen
  const names = new Map((await db.select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name }).from(schema.bankAccounts)).map((a) => [a.id, a.name]));
  return rows
    .filter((r) => r.status !== "wartet")
    .map((r) => ({
      ...r,
      accounts: r.accounts.map((a) => ({ ...a, name: names.get(a.bankAccountId) ?? a.name })),
      validUntil: r.validUntil?.toISOString() ?? null,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      renewSoon: r.status === "aktiv" && r.validUntil !== null && r.validUntil.getTime() - Date.now() < RENEW_WARNING_DAYS * DAY,
    }));
}

/** Trennt eine Verbindung: Zustimmung bei Enable Banking beenden und Eintrag löschen. Umsätze bleiben. */
export async function removeConnection(actor: string, id: string): Promise<void> {
  const [connection] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, id));
  if (!connection) throw new BankError("Verbindung nicht gefunden.");
  if (connection.ciphertext && (await enableBankingConfigured())) {
    await (await client())
      .deleteSession(decrypt(connection.ciphertext).toString("utf8"))
      .catch(() => undefined);
  }
  await withActor(actor, (tx) => tx.delete(schema.bankConnections).where(eq(schema.bankConnections.id, id)));
}
