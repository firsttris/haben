import { findDuplicateCandidates } from "@haben/import";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";

/** Im gehaltenen Kontolock, nachdem Import und wieder beobachtete Umsätze gespeichert wurden. */
export async function recordDuplicateCandidates(tx: Tx, accountId: string, days: string[], newIds: ReadonlySet<string>, stableIds: ReadonlySet<string>) {
  if (days.length === 0 || newIds.size === 0) return;
  await insertCandidates(tx, await scanAccount(tx, accountId, { days, newIds, stableIds }));
}

type Scan = { days: string[]; newIds: ReadonlySet<string>; stableIds: ReadonlySet<string> };

async function scanAccount(tx: Tx, accountId: string, scope?: Scan) {
  const t = schema.bankTransactions;
  const where = and(eq(t.bankAccountId, accountId), scope ? inArray(t.bookingDate, scope.days) : undefined);
  const rows = await tx
    .select({
      id: t.id,
      accountId: t.bankAccountId,
      importId: t.importId,
      bookingDate: t.bookingDate,
      amount: t.amount,
      currency: t.currency,
      purpose: t.purpose,
      iban: t.counterpartyIban,
    })
    .from(t)
    .where(where)
    .orderBy(asc(t.createdAt), asc(t.id));
  const observations = await tx
    .select({ id: schema.bankImportTransactions.transactionId, importId: schema.bankImportTransactions.bankImportId })
    .from(schema.bankImportTransactions)
    .innerJoin(t, eq(t.id, schema.bankImportTransactions.transactionId))
    .where(where);
  const byId = new Map(rows.map(({ id, importId }) => [id, new Set([importId])]));
  for (const { id, importId } of observations) byId.get(id)?.add(importId);
  const stableIds = scope?.stableIds ?? (await addHistoricBindings(tx, accountId, byId));
  // Neue Zeilen stehen nach allen schon vorhandenen, auch bei gleicher Uhrzeit mehrerer Importe.
  if (scope) rows.sort((a, b) => Number(scope.newIds.has(a.id)) - Number(scope.newIds.has(b.id)));
  return findDuplicateCandidates(
    rows.map(({ iban, ...row }) => ({ ...row, counterpartyIban: iban ?? undefined, fetchIds: byId.get(row.id)!, stableReference: stableIds.has(row.id) })),
    scope?.newIds,
  );
}

/** Frühere Vertragsimporte kannten schon stabile Zuordnungen und deren ersten Abruf. */
async function addHistoricBindings(tx: Tx, accountId: string, fetches: Map<string, Set<string>>) {
  const m = schema.importMovements;
  const b = schema.importBatches;
  const t = schema.bankTransactions;
  const stable = sql<boolean>`not exists (
    select 1 from import_batches earlier where earlier.source_id = ${m.sourceId}
      and ${m.sourceEventId} = any(earlier.ambiguous_entry_references)
  )`;
  const rows = await tx
    .select({ id: m.transactionId, importId: b.bankImportId, stable })
    .from(m)
    .innerJoin(b, eq(b.id, m.batchId))
    .innerJoin(t, eq(t.id, m.transactionId))
    .where(eq(t.bankAccountId, accountId));
  for (const { id, importId } of rows) fetches.get(id)?.add(importId);
  const r = schema.importResolutions;
  const c = schema.importConflicts;
  // „Als weiteren Umsatz übernehmen“ behält eine Quellenreferenz, aber keinen gemeinsamen angenommenen Abruf.
  const resolved = await tx
    .select({ id: t.id })
    .from(r)
    .innerJoin(c, eq(c.id, r.conflictId))
    .innerJoin(m, eq(m.id, c.movementId))
    .innerJoin(t, eq(t.id, r.transactionId))
    .where(and(eq(t.bankAccountId, accountId), stable));
  return new Set([...rows.filter((row) => row.stable), ...resolved].map(({ id }) => id));
}

type Candidate = ReturnType<typeof findDuplicateCandidates>[number];

async function insertCandidates(tx: Tx, candidates: Candidate[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < candidates.length; i += 500) {
    const inserted = await tx
      .insert(schema.bankDuplicateReviews)
      .values(candidates.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: schema.bankDuplicateReviews.id });
    added += inserted.length;
  }
  return added;
}

/** Dauerhafter Abschluss auch ohne Treffer; Fehler rollen Prüfung und Marker gemeinsam zurück. */
export async function runExistingDuplicateCheck(): Promise<{ added: number } | null> {
  return withActor("system:bank-dublettenpruefung", async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.bank-dublettenpruefung.865'))`);
    const [done] = await tx.select().from(schema.bankDuplicateCheck).where(eq(schema.bankDuplicateCheck.id, 1));
    if (done) return null;
    const accounts = await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).orderBy(asc(schema.bankAccounts.id)).for("update");
    const candidates: Candidate[] = [];
    for (const { id } of accounts) candidates.push(...(await scanAccount(tx, id)));
    // Vor dem Audit die bereits vorhandenen Fremdschlüssel sperren; globale Reihenfolge wie bei Verrechnungen.
    const ids = [...new Set(candidates.flatMap((row) => [row.transactionId, row.originalTransactionId]))].sort();
    for (let i = 0; i < ids.length; i += 500) {
      const t = schema.bankTransactions;
      await tx
        .select({ id: t.id })
        .from(t)
        .where(inArray(t.id, ids.slice(i, i + 500)))
        .orderBy(asc(t.id))
        .for("key share");
    }
    const added = await insertCandidates(tx, candidates);
    await tx.insert(schema.bankDuplicateCheck).values({ id: 1 });
    return { added };
  });
}
