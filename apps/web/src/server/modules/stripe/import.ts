import { createHash } from "node:crypto";
import { type StripeBalanceTransaction, stripeBatch, stripeEventOf, stripeStatement } from "@haben/import";
import { and, asc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { BankError, eventKey, recordRefusedBatch, storeBatch } from "../bank/index.ts";

/*
 * Übernahme der Balance Transactions von Stripe in das Konto des Zahlungsdienstleisters.
 *
 * Die Balance Transactions werden zum Kontoauszug (`stripeStatement` in @haben/import, dieselbe Lesart wie beim CSV-Export
 * „Balance history“) und zugleich zur Lieferung des Importvertrags (`stripeBatch`, #306). Gespeichert wird über
 * `storeBatch` mit der Kennung des Stripe-Kontos als Quelle (Konto der Art „psp“): Haben erkennt jede Bewegung an der ID
 * der Balance Transaction (`txn_…`), die Gebühr daran mit dem Zusatz „#fee“. Umsätze, die vor der Quellenbindung aus dem
 * CSV-Export kamen, verbindet `storeBatch` über den Dubletten-Hash mit ihrer Kennung, statt sie neu anzulegen; eine Lieferung,
 * die der Vertrag ablehnt, speichert nichts. Der Bankabgleich ordnet Zahlung und Gebühr über die Referenzen `txn_…` und
 * `txn_…-gebuehr` zu.
 *
 * Gibt es kein Konto der Art Zahlungsdienstleister mit Anbieter Stripe, sagt das Ergebnis das und legt nichts an.
 */

export interface StripeImportResult {
  /** null: kein Konto des Dienstleisters vorhanden */
  accountName: string | null;
  added: number;
  messages: string[];
}

export interface StripeImportOptions {
  /** Kennung des Stripe-Kontos (`acct_…`): Quelle des Abrufs */
  accountId: string;
  /** Erster abgerufener Tag und letzter (UTC), YYYY-MM-DD */
  dateFrom: string;
  dateTo: string;
  now: Date;
}

async function providerAccount() {
  const [account] = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"), eq(schema.bankAccounts.provider, "stripe")))
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}

/** Die Balance Transactions ins Konto des Dienstleisters übernehmen */
export async function importStripe(actor: string, transactions: StripeBalanceTransaction[], options: StripeImportOptions): Promise<StripeImportResult> {
  const account = await providerAccount();
  if (!account) {
    return {
      accountName: null,
      added: 0,
      messages: [
        "Für Stripe gibt es noch kein Konto. Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter Stripe an; dann übernimmt Haben die Umsätze.",
      ],
    };
  }
  const statement = stripeStatement(transactions);
  const result: StripeImportResult = { accountName: account.name, added: 0, messages: [...statement.warnings] };
  if (statement.transactions.length === 0) return result;
  const sha256 = createHash("sha256")
    .update(new TextEncoder().encode(JSON.stringify(statement.transactions)))
    .digest("hex");
  const day = options.now.toISOString().slice(0, 10);
  const batch = stripeBatch({
    externalAccountId: options.accountId,
    transactions,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    fetchedAt: options.now.toISOString(),
    // Fenster und Zeitpunkt: zwei Abrufe zur selben Zeit mit anderem Fenster sind zwei Lieferungen, nicht eine mit anderem Inhalt
    fetchId: `stripe-${options.dateFrom}-${options.now.toISOString()}`,
  });
  const input = {
    batch,
    binding: { provider: "stripe", externalAccountId: options.accountId, accountKind: "psp" as const },
    statement,
    eventOf: stripeEventOf(new Set(batch.movements.map(eventKey))),
    source: { filename: `stripe-abruf-${day}.json`, sha256 },
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
