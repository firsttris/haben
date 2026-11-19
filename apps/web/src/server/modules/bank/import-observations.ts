import { and, eq, inArray, or } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

type Observation = {
  ids?: readonly string[];
  hashes?: readonly { dedupHash: string; currency: string }[];
};

/** Vor dem Audit die Prüf- und Beobachtungszeilen gemeinsam nach ID sperren, wie bei einer Verrechnung. */
export async function lockImportObservations(
  tx: Tx,
  accountId: string,
  days: readonly string[],
  { ids = [], hashes = [] }: Observation = {},
): Promise<string[]> {
  // Der alte Dubletten-Hash enthält keine Währung. Einen Abruf nur mit passender Währung belegen.
  const groups = new Map<string, Set<string>>();
  for (const { dedupHash, currency } of hashes) {
    const group = groups.get(currency) ?? new Set<string>();
    group.add(dedupHash);
    groups.set(currency, group);
  }
  const t = schema.bankTransactions;
  const observedIds = new Set(ids);
  const filter = or(
    days.length ? inArray(t.bookingDate, days) : undefined,
    observedIds.size ? inArray(t.id, [...observedIds]) : undefined,
    ...[...groups].map(([currency, group]) => and(eq(t.currency, currency), inArray(t.dedupHash, [...group]))),
  );
  if (!filter) return [];
  const rows = await tx
    .select({ id: t.id, currency: t.currency, hash: t.dedupHash })
    .from(t)
    .where(and(eq(t.bankAccountId, accountId), filter))
    .orderBy(t.id)
    .for("key share");
  return rows.filter(({ id, currency, hash }) => observedIds.has(id) || groups.get(currency)?.has(hash)).map(({ id }) => id);
}

/** Neue Zeilen sind bereits über ihren Import verbunden, hier nur wieder gelieferte Zeilen speichern. */
export async function recordImportObservations(tx: Tx, bankImportId: string, ids: string[]) {
  if (ids.length > 0) await tx.insert(schema.bankImportTransactions).values([...new Set(ids)].map((transactionId) => ({ bankImportId, transactionId })));
}
