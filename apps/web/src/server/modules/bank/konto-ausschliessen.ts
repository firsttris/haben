import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { withActor } from "../../db/actor.ts";
import { BankError } from "./bank.ts";

/**
 * Fremdes Bankkonto ausschließen (#462). Zu einem Bankzugang gehören manchmal Konten, die nicht zu dieser Firma gehören
 * (etwa das Konto einer zweiten Firma). Löschen geht nicht: Umsätze sind nach dem Import gesperrt. Ausschließen ist das
 * Gegenstück: Das Konto ist ausgeblendet, nimmt keinen Import und keinen Abruf mehr an und fehlt in Abgleich,
 * Vorschlägen und Export. Gelöscht wird nichts, die Umsätze bleiben in der Datenbank; der Schritt steht im
 * Änderungsprotokoll von bank_accounts. Erlaubt nur, solange kein Umsatz des Kontos zugeordnet, verrechnet oder
 * ausgebucht ist; dieselbe Regel prüft ein Trigger (0193), der auch eine gleichzeitige Zuordnung abfängt.
 */

/** Was dagegen spricht, das Konto auszuschließen; leer, wenn es geht */
async function hindernis(tx: Pick<typeof db, "execute">, accountId: string): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select
      exists (select 1 from allocations a join bank_transactions t on t.id = a.transaction_id where t.bank_account_id = ${accountId}) as zugeordnet,
      exists (select 1 from bank_neutralizations n join bank_transactions t on t.id in (n.transaction_id, n.counter_transaction_id) where t.bank_account_id = ${accountId}) as verrechnet,
      exists (select 1 from write_offs w join bank_transactions t on t.id = w.transaction_id where t.bank_account_id = ${accountId}) as ausgebucht
  `)) as unknown as { zugeordnet: boolean; verrechnet: boolean; ausgebucht: boolean }[];
  if (row?.zugeordnet) return "Ein Umsatz dieses Kontos ist schon zugeordnet. Dann gehört das Konto zu dieser Firma und lässt sich nicht ausschließen.";
  if (row?.verrechnet) return "Ein Umsatz dieses Kontos ist schon verrechnet. Dann gehört das Konto zu dieser Firma und lässt sich nicht ausschließen.";
  if (row?.ausgebucht) return "Zu einem Umsatz dieses Kontos gibt es eine Ausbuchung. Dann gehört das Konto zu dieser Firma und lässt sich nicht ausschließen.";
  return null;
}

/** Warum sich ein Konto nicht ausschließen lässt, für die Oberfläche; null, wenn es geht oder es schon ausgeschlossen ist */
export async function excludeBlocker(accountId: string): Promise<string | null> {
  const [account] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
  if (!account || account.excludedAt) return null;
  if (account.purpose === "zahlungsdienstleister") return "Ein Zahlungsdienstleister hat ein eigenes Verrechnungskonto und lässt sich nicht ausschließen.";
  return hindernis(db, accountId);
}

/** Schließt ein Konto aus, das nicht zu dieser Firma gehört; nur ohne zugeordneten, verrechneten oder ausgebuchten Umsatz */
export async function excludeAccount(actor: string, accountId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId)).for("update");
    if (!account) throw new BankError("Konto nicht gefunden.");
    if (account.excludedAt) throw new BankError(`${account.name} ist schon ausgeschlossen.`);
    if (account.purpose === "zahlungsdienstleister") {
      throw new BankError("Ein Zahlungsdienstleister hat ein eigenes Verrechnungskonto und lässt sich nicht ausschließen.");
    }
    const grund = await hindernis(tx, accountId);
    if (grund) throw new BankError(grund);
    try {
      await tx.update(schema.bankAccounts).set({ excludedAt: sql`now()` }).where(eq(schema.bankAccounts.id, accountId));
    } catch (error) {
      // Eine Zuordnung, die gleichzeitig durchging, fängt der Trigger ab
      if (
        error instanceof Error &&
        /Ein Umsatz des Kontos|Zu einem Umsatz des Kontos/.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`)
      ) {
        throw new BankError("Inzwischen wurde ein Umsatz dieses Kontos zugeordnet. Das Konto gehört zu dieser Firma und lässt sich nicht ausschließen.");
      }
      throw error;
    }
  });
}

/** Nimmt ein ausgeschlossenes Konto wieder auf; Umsätze und Import gehen dann wie zuvor weiter */
export async function includeAccount(actor: string, accountId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId)).for("update");
    if (!account) throw new BankError("Konto nicht gefunden.");
    if (!account.excludedAt) throw new BankError(`${account.name} ist nicht ausgeschlossen.`);
    await tx.update(schema.bankAccounts).set({ excludedAt: null }).where(eq(schema.bankAccounts.id, accountId));
  });
}

/** Ausgeschlossene Konten mit der Zahl ihrer Umsätze, für die Liste zum Wiederaufnehmen */
export async function listExcludedAccounts() {
  const rows = await db
    .select({
      id: schema.bankAccounts.id,
      name: schema.bankAccounts.name,
      iban: schema.bankAccounts.iban,
      excludedAt: schema.bankAccounts.excludedAt,
      // Tabelle ausdrücklich nennen: in der Spaltenliste schreibt drizzle nur "id", das träfe in der Unterabfrage t.id
      transactionCount: sql<number>`(select count(*)::int from bank_transactions t where t.bank_account_id = ${schema.bankAccounts}.id)`,
    })
    .from(schema.bankAccounts)
    .where(isNotNull(schema.bankAccounts.excludedAt))
    .orderBy(asc(schema.bankAccounts.name));
  return rows;
}
