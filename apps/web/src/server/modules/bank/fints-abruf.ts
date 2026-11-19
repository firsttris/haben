import { type FintsClient, type FintsKonto, fintsClient, fintsStatement, fintsUmsaetze } from "@haben/import";
import { eq, isNotNull } from "drizzle-orm";
import { BankError } from "./bank-error.ts";
import { storeStatement } from "./statement-import.ts";
import { AUTO_SYNC_INTERVAL_MS, BANK_SYNC_ACTOR, syncStart } from "./bank-sync.ts";
import { fintsGeheimnisLesen, fintsGeheimnisVerschluesseln } from "./fints-geheim.ts";
import { fintsConfigured, fintsProduktOderFehler } from "./fints-produkt.ts";
import { type FintsSchritt, mitTan } from "./fints-vorgang.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { sha256Of } from "../../storage.ts";
import { today as todayInGermany } from "../../today.ts";

/*
 * Kontoabruf über FinTS (#654): Umsätze der Konten einer Verbindung holen, je Konto wie eine Datei speichern. Der Abruf
 * auf Knopfdruck fragt eine TAN im Browser ab; der Abruf im Hintergrund wartet nie auf eine TAN, sondern setzt den Status
 * „tan“. Lehnt die Bank ab (etwa eine falsche PIN), steht die Verbindung auf „fehler“ und der Hintergrund versucht es
 * nicht wieder: Banken sperren den Zugang nach wenigen Fehlversuchen.
 */

export interface Abruf {
  actor: string;
  id: string;
  client: FintsClient;
  /** Geht mit den Bankdaten wieder verschlüsselt in die Zeile */
  pin: string;
  today: string;
  /** Auf Knopfdruck: eine TAN fragt der Browser ab */
  interaktiv: boolean;
  bankName: string;
  accounts: BankConnectionAccount[];
  /** Erster Satz der Meldung, etwa „DKB verbunden“ */
  einleitung?: string;
  hinweise: string[];
  neu?: number;
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hält Abrufstand, Bankdaten (BPD, UPD und Kundensystem-ID kann jede Antwort der Bank ändern; verschlüsselt mit der PIN,
 * fints-geheim.ts) und das Ergebnis fest.
 * status null: bleibt, wie er ist (Netzfehler); „Zuletzt abgerufen“ zählt nur ein gelungener Abruf.
 */
async function abschliessen(a: Abruf, fehler: string | null, status: "aktiv" | "tan" | "fehler" | null): Promise<FintsSchritt> {
  await withActor(a.actor, (tx) =>
    tx
      .update(schema.fintsConnections)
      .set({
        accounts: a.accounts,
        ciphertext: fintsGeheimnisVerschluesseln({ pin: a.pin, bankdaten: a.client.config.bankingInformation }),
        lastError: fehler,
        ...(fehler === null ? { lastSyncAt: new Date() } : {}),
        ...(status ? { status } : {}),
      })
      .where(eq(schema.fintsConnections.id, a.id)),
  );
  const neu = a.neu ?? 0;
  return {
    art: "fertig",
    ok: fehler === null,
    meldung: fehler ?? `${a.einleitung ?? a.bankName}, ${neu} neue Umsätze.`,
    hinweise: a.hinweise,
    neu,
  };
}

async function speichern(a: Abruf, index: number, konto: FintsKonto, statements: Parameters<typeof fintsStatement>[0]["statements"], von: string) {
  const account = a.accounts[index]!;
  const statement = fintsStatement({ iban: account.iban, accountName: konto.product, statements, dateFrom: von, dateTo: a.today });
  const stored = await withActor(a.actor, (tx) =>
    storeStatement(
      tx,
      statement,
      { filename: `FinTS-Abruf ${a.bankName} ${a.today}`, sha256: sha256Of(Buffer.from(JSON.stringify(statements), "utf8")) },
      account.bankAccountId,
    ),
  );
  a.neu = (a.neu ?? 0) + stored.added;
  if (stored.gap) a.hinweise.push(stored.gap);
  if (stored.quelle) a.hinweise.push(stored.quelle);
  a.accounts[index] = { ...account, syncedTo: a.today };
}

/** Ruft die Konten ab index ab, eines nach dem anderen; nach einer TAN geht es beim selben Konto weiter */
export async function kontenAbrufen(a: Abruf, index = 0): Promise<FintsSchritt> {
  const ausgeschlossen = new Set(
    (await db.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(isNotNull(schema.bankAccounts.excludedAt))).map((r) => r.id),
  );
  let i = index;
  // Ausgeschlossene Konten (#462) gehören nicht zu dieser Firma: kein Abruf, die Verbindung läuft für die anderen weiter
  while (i < a.accounts.length && ausgeschlossen.has(a.accounts[i]!.bankAccountId)) i++;
  const account = a.accounts[i];
  if (!account) return abschliessen(a, null, "aktiv");
  const konto = a.client.config.bankingInformation.upd?.bankAccounts.find((k) => k.iban?.replace(/\s/g, "").toUpperCase() === account.iban);
  if (!konto) return abschliessen(a, `Die Bank meldet das Konto …${account.iban.slice(-4)} nicht mehr. Bitte die Verbindung neu einrichten.`, "fehler");
  const { from } = await syncStart(account, a.today, "fints");
  let antwort;
  try {
    antwort = await fintsUmsaetze(a.client, konto, from, a.today);
  } catch (error) {
    return abschliessen(a, `Abruf fehlgeschlagen: ${text(error)}`, null);
  }
  if (antwort.art === "tan" && !a.interaktiv) {
    return abschliessen(a, "Die Bank verlangt eine TAN. Unter Bank „Jetzt abrufen“ wählen und mit TAN bestätigen.", "tan");
  }
  return mitTan(a.actor, antwort, {
    weiter: (w) => fintsUmsaetze(a.client, konto, from, a.today, w),
    fertig: async (statements) => {
      await speichern(a, i, konto, statements, from);
      return kontenAbrufen(a, i + 1);
    },
    abgelehnt: (meldung) => abschliessen(a, `Abruf fehlgeschlagen: ${meldung}`, "fehler"),
    ausfall: (error) => abschliessen(a, `Abruf fehlgeschlagen: ${text(error)}`, null),
  });
}

/** Abruf einer gespeicherten Verbindung mit gespeicherter PIN, BPD, UPD und Kundensystem-ID */
async function abrufStarten(actor: string, id: string, today: string, interaktiv: boolean): Promise<FintsSchritt> {
  const [c] = await db.select().from(schema.fintsConnections).where(eq(schema.fintsConnections.id, id));
  if (!c) throw new BankError("Verbindung nicht gefunden.");
  const { pin, bankdaten } = fintsGeheimnisLesen(c.ciphertext);
  const client = fintsClient(
    fintsProduktOderFehler(),
    { url: c.url, blz: c.bankCode, benutzer: c.login, kundenId: c.customerId, pin },
    { bankingInformation: bankdaten, tanVerfahren: c.tanMethod, tanMedium: c.tanMedium },
  );
  return kontenAbrufen({ actor, id, client, pin, today, interaktiv, bankName: c.bankName, accounts: [...c.accounts], hinweise: [] });
}

/** „Jetzt abrufen“: verlangt die Bank eine TAN, fragt der Browser sie ab */
export function fintsAbrufen(actor: string, id: string, today = todayInGermany()): Promise<FintsSchritt> {
  return abrufStarten(actor, id, today, true);
}

/**
 * Abruf im Hintergrund (Scheduler, je Verbindung höchstens alle 20 Stunden): aktive Verbindungen, deren letzter Versuch lange genug her ist. Ein Fehlschlag zählt als Versuch,
 * damit der nächste erst am nächsten Tag kommt; nach „tan“ oder „fehler“ wartet die Verbindung auf die Person.
 */
export async function runDueFintsSyncs(now = new Date()): Promise<{ synced: number; added: number; errors: string[] }> {
  const summary = { synced: 0, added: 0, errors: [] as string[] };
  if (!fintsConfigured()) return summary;
  const rows = await db
    .select({ id: schema.fintsConnections.id, bankName: schema.fintsConnections.bankName, lastSyncAt: schema.fintsConnections.lastSyncAt })
    .from(schema.fintsConnections)
    .where(eq(schema.fintsConnections.status, "aktiv"));
  for (const row of rows) {
    if (row.lastSyncAt && now.getTime() - row.lastSyncAt.getTime() < AUTO_SYNC_INTERVAL_MS) continue;
    try {
      const result = await abrufStarten(BANK_SYNC_ACTOR, row.id, todayInGermany(now), false);
      summary.synced++;
      if (result.art !== "fertig") continue;
      summary.added += result.neu;
      if (!result.ok) {
        summary.errors.push(`${row.bankName}: ${result.meldung}`);
        await withActor(BANK_SYNC_ACTOR, (tx) => tx.update(schema.fintsConnections).set({ lastSyncAt: now }).where(eq(schema.fintsConnections.id, row.id)));
      }
    } catch (error) {
      summary.errors.push(`${row.bankName}: ${text(error)}`);
    }
  }
  return summary;
}
