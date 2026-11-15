import { createHash } from "node:crypto";
import { parseEtsyLedger, type EtsyLedgerEntry, type ParsedStatement } from "@haben/import";
import { and, asc, eq } from "drizzle-orm";
import { storeStatement } from "../bank/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";

/*
 * Übernahme des Etsy-Zahlungsverlaufs in das Konto des Zahlungsdienstleisters.
 *
 * Der Verlauf wird zum Kontoauszug (etsy-ledger.ts in @haben/import) und läuft danach durch denselben Weg wie eine
 * hochgeladene Datei: Haben legt die Umsätze im Konto des Dienstleisters an, die Dublettenprüfung greift je Umsatz
 * (Buchungstag, Betrag, Zweck), und der Bankabgleich findet Verkäufe über die Bestellnummer im Zweck.
 *
 * Gibt es kein Konto der Art Zahlungsdienstleister mit Anbieter Etsy, sagt das Ergebnis das und legt nichts an.
 */

export interface EtsyImportResult {
  /** null: kein Konto des Dienstleisters vorhanden */
  accountName: string | null;
  added: number;
  messages: string[];
}

async function providerAccount() {
  const [account] = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"), eq(schema.bankAccounts.provider, "etsy")))
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}

export interface EtsyImportOptions {
  /** Bestellnummer je Zahlungs- oder Erstattungsnummer aus dem Payments-Abruf */
  orderFor?: (referenceId: string) => string | undefined;
  /** Gebühren, Werbung und Steuer je Monat bündeln (Vorgabe des Zugangs) */
  sammelzeilen: boolean;
  /** Bündeln nur bis zu diesem Tag; später entstandene Gebühren kommen mit dem nächsten Abruf */
  gebuehrenBis?: string;
  /** Kennung des Abrufs für die Belegdatei, z. B. „2026-11-14“ */
  reference: string;
}

/** Verlauf als Kontoauszug lesen, ohne ihn zu buchen (Vorschau und Tests) */
export function etsyStatement(entries: EtsyLedgerEntry[], options: EtsyImportOptions): ParsedStatement {
  return parseEtsyLedger(entries, {
    orderFor: options.orderFor,
    sammelzeilen: options.sammelzeilen,
    gebuehrenBis: options.gebuehrenBis,
  });
}

/** Den Verlauf ins Konto des Dienstleisters übernehmen */
export async function importEtsyLedger(actor: string, entries: EtsyLedgerEntry[], options: EtsyImportOptions): Promise<EtsyImportResult> {
  const account = await providerAccount();
  if (!account) {
    return {
      accountName: null,
      added: 0,
      messages: [
        "Für Etsy gibt es noch kein Konto. Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter Etsy an; dann übernimmt Haben den Zahlungsverlauf.",
      ],
    };
  }
  const statement = etsyStatement(entries, options);
  const result: EtsyImportResult = { accountName: account.name, added: 0, messages: [...statement.warnings] };
  if (statement.transactions.length === 0) return result;
  const bytes = new TextEncoder().encode(JSON.stringify(statement.transactions));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `etsy-zahlungsverlauf-${options.reference}.json`;
  const imported = await withActor(actor, (tx) => storeStatement(tx, statement, { filename, sha256 }, account.id));
  result.added = imported.added;
  result.messages.push(...imported.warnings);
  if (imported.quelle) result.messages.push(imported.quelle);
  if (imported.gap) result.messages.push(imported.gap);
  return result;
}
