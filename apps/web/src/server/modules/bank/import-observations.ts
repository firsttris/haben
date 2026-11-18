import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/** Der alte Dubletten-Hash enthält keine Währung. Einen Abruf deshalb nur mit passender Währung belegen. */
export function observedHashFilter(rows: { dedupHash: string; currency: string }[]): SQL | undefined {
  const groups = new Map<string, Set<string>>();
  for (const { dedupHash, currency } of rows) {
    const hashes = groups.get(currency) ?? new Set<string>();
    hashes.add(dedupHash);
    groups.set(currency, hashes);
  }
  const t = schema.bankTransactions;
  return or(...[...groups].map(([currency, hashes]) => and(eq(t.currency, currency), inArray(t.dedupHash, [...hashes]))));
}

/** Fremdschlüssel zu vorhandenen Umsätzen vor dem ersten Audit-Eintrag sperren. */
export async function lockImportObservations(tx: Tx, accountId: string, filter: SQL | undefined): Promise<string[]> {
  if (!filter) return [];
  const rows = await tx
    .select({ id: schema.bankTransactions.id })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), filter))
    .orderBy(schema.bankTransactions.id)
    .for("key share");
  return rows.map(({ id }) => id);
}

/** Neue Zeilen sind bereits über ihren Import verbunden, hier nur wieder gelieferte Zeilen speichern. */
export async function recordImportObservations(tx: Tx, bankImportId: string, ids: string[]) {
  if (ids.length > 0) await tx.insert(schema.bankImportTransactions).values([...new Set(ids)].map((transactionId) => ({ bankImportId, transactionId })));
}
