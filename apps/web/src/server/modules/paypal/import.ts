import { createHash } from "node:crypto";
import { classify, paypalBatch, paypalEventOf, paypalStatement, type PayPalTransaction } from "@haben/import";
import { and, asc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { BankError, eventKey, recordRefusedBatch, storeBatch } from "../bank/index.ts";

/*
 * Übernahme der Transaction Search von PayPal in das Konto des Zahlungsdienstleisters.
 *
 * Die Zeilen werden eingeordnet (`classify`), zum Kontoauszug (`paypalStatement` in @haben/import, derselbe Parser wie beim
 * Aktivitätenexport) und zugleich zur Lieferung des Importvertrags (`paypalBatch`, #306). Gespeichert wird über `storeBatch`
 * mit der Kennung des Händlerkontos als Quelle (Konto der Art „psp“): Haben erkennt jede Bewegung an der Transaktions-ID,
 * die Gebühr daran mit dem Zusatz „#fee“. Eine Lieferung, die der Vertrag ablehnt, speichert nichts.
 *
 * Gibt es kein Konto der Art Zahlungsdienstleister mit Anbieter PayPal, sagt das Ergebnis das und legt nichts an.
 */

export interface PayPalImportResult {
  /** null: kein Konto des Dienstleisters vorhanden */
  accountName: string | null;
  added: number;
  messages: string[];
  /** Tag der ältesten ausstehenden Zahlung (Status P): der nächste Abruf holt ab diesem Tag erneut */
  offenSeit: string | null;
}

export interface PayPalImportOptions {
  /** Kennung des Händlerkontos: Quelle des Abrufs */
  accountId: string;
  /** Zeitzone des Kontos: nach ihr bildet Haben den Buchungstag */
  zone: string;
  /** Erster abgerufener Tag und letzter, YYYY-MM-DD */
  dateFrom: string;
  dateTo: string;
  now: Date;
}

async function providerAccount() {
  const [account] = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"), eq(schema.bankAccounts.provider, "paypal")))
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}

/** Meldungen zu dem, was nicht als Umsatz ankommt, nach Grund zusammengefasst, mit den ersten Kennungen */
function unsupportedMessages(list: { sourceEventId?: string; reason: string; final?: true }[]): string[] {
  const groups = new Map<string, { ids: string[]; final: boolean }>();
  for (const u of list) {
    const group = groups.get(u.reason) ?? { ids: [], final: u.final === true };
    if (u.sourceEventId) group.ids.push(u.sourceEventId);
    groups.set(u.reason, group);
  }
  return [...groups].map(([reason, { ids, final }]) => {
    const shown = ids.slice(0, 5).join(", ") + (ids.length > 5 ? ", …" : "");
    return `${ids.length} Zeile${ids.length === 1 ? "" : "n"} nicht übernommen: ${reason} (${shown}).${final ? "" : " Der Zeitraum gilt nicht als vollständig abgerufen."}`;
  });
}

/** Die Transaktionen ins Konto des Dienstleisters übernehmen */
export async function importPayPal(actor: string, transactions: PayPalTransaction[], options: PayPalImportOptions): Promise<PayPalImportResult> {
  const account = await providerAccount();
  if (!account) {
    return {
      accountName: null,
      added: 0,
      offenSeit: null,
      messages: [
        "Für PayPal gibt es noch kein Konto. Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter PayPal an; dann übernimmt Haben die Umsätze.",
      ],
    };
  }
  const classified = classify(transactions, { zone: options.zone, dateFrom: options.dateFrom, dateTo: options.dateTo });
  const statement = paypalStatement(classified.entries);
  const ausstehend = classified.unsupported.filter((u) => u.reason.startsWith("Status P")).map((u) => u.bookingDate!);
  const result: PayPalImportResult = {
    accountName: account.name,
    added: 0,
    offenSeit: ausstehend.sort()[0] ?? null,
    messages: [...statement.warnings, ...unsupportedMessages(classified.unsupported)],
  };
  if (statement.transactions.length === 0 && classified.unsupported.length === 0) return result;
  const sha256 = createHash("sha256")
    .update(new TextEncoder().encode(JSON.stringify(statement.transactions)))
    .digest("hex");
  const batch = paypalBatch({
    externalAccountId: options.accountId,
    classified,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    fetchedAt: options.now.toISOString(),
    // Fenster und Zeitpunkt: zwei Abrufe zur selben Zeit mit anderem Fenster sind zwei Lieferungen, nicht eine mit anderem Inhalt
    fetchId: `paypal-${options.dateFrom}-${options.now.toISOString()}`,
  });
  const input = {
    batch,
    binding: { provider: "paypal", externalAccountId: options.accountId, accountKind: "psp" as const },
    statement,
    eventOf: paypalEventOf(new Set(batch.movements.map(eventKey))),
    source: { filename: `paypal-abruf-${options.now.toISOString().slice(0, 10)}.json`, sha256 },
  };
  let imported: Awaited<ReturnType<typeof storeBatch>>;
  try {
    imported = await withActor(actor, (tx) => storeBatch(tx, input, account.id));
  } catch (error) {
    // Abgelehnt (Vertrag oder Konflikt): gespeichert ist nichts, der Grund steht wie bei Enable Banking im Importprotokoll
    if (error instanceof BankError) await withActor(actor, (tx) => recordRefusedBatch(tx, account.id, input, error));
    throw error;
  }
  result.added = imported.added;
  result.messages.push(...imported.warnings);
  if (imported.quelle) result.messages.push(imported.quelle);
  if (imported.gap) result.messages.push(imported.gap);
  return result;
}
