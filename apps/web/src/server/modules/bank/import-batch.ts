import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import {
  advanceCheckpoint,
  batchFingerprint,
  classifyBatch,
  classifyMovements,
  type ImportBatch,
  type ImportMovement,
  type KnownMovement,
  knownMovement,
  movementKey,
  type ParsedStatement,
  type ParsedTransaction,
  type SourceBinding,
  transactionHash,
  validateBatch,
  withDedupHashes,
} from "@haben/import";
import { schema, type Tx } from "../../db/index.ts";
import { BankError, type ImportResult, insertStatement, knownHashes, prepareStatement, statementResult } from "./bank.ts";

/*
 * Schritt 3 aus #306: Eine Lieferung des Importvertrags speichern. Bewegungen erkennt Haben an ihrer Quellenidentität
 * (`import_movements`), nicht am Inhalt; `bank_transactions` bleibt, wie es ist, und bekommt weiter einen Dubletten-Hash,
 * damit Datei-Importe die Umsätze erkennen. Mit einer ungültigen Lieferung oder einem Konflikt speichert Haben nichts.
 *
 * Alias (in #306 abgestimmt): Umsätze, die vor der Quellenbindung importiert wurden, kennt `import_movements` nicht.
 * Eine neue Bewegung mit demselben Dubletten-Hash wird mit so einer Zeile verbunden statt neu angelegt, wie es der
 * bisherige Weg getan hätte. Mit Zeilen, die nach der Bindung kamen, gleicht Haben nie über den Inhalt ab.
 */

export interface StoreBatchInput {
  batch: ImportBatch;
  binding: Omit<SourceBinding, "cutoverDate">;
  /** Derselbe Abruf als Kontoauszug: Zeitraum, Salden und Warnungen fürs Importprotokoll, Umsätze in Lieferreihenfolge */
  statement: ParsedStatement;
  /** Ereignis zu einem Umsatz des Auszugs; ohne stabile Kennung undefined, dann erkennt Haben ihn wie bisher am Inhalt */
  eventOf: (t: ParsedTransaction) => string | undefined;
  source: { filename: string; sha256: string };
}

export interface BatchResult extends ImportResult {
  /** Bis einschließlich diesem Tag vollständig abgerufen */
  checkpoint: string | undefined;
  complete: boolean;
  /** Warum der Zeitraum offen bleibt */
  reason?: string;
  /** Dieselbe Lieferung kam schon; Haben hat nichts neu gespeichert */
  replay: boolean;
}

type Row = ParsedTransaction & { dedupHash: string };

/** Quellenbindung zur Kennung; fehlt sie, wird sie für dieses Konto angelegt. Gehört sie zu einem anderen Konto, Fehler. */
async function sourceFor(tx: Tx, binding: StoreBatchInput["binding"], accountId: string) {
  const where = and(eq(schema.importSources.provider, binding.provider), eq(schema.importSources.externalAccountId, binding.externalAccountId));
  const [existing] = await tx.select().from(schema.importSources).where(where);
  if (existing) {
    if (existing.bankAccountId !== accountId) throw new BankError("Die Quelle des Abrufs ist schon mit einem anderen Konto verbunden.");
    return existing;
  }
  // Parallel angelegt: der eindeutige Index hält die zweite Bindung ab, dann gilt die erste
  await tx
    .insert(schema.importSources)
    .values({ bankAccountId: accountId, provider: binding.provider, externalAccountId: binding.externalAccountId, accountKind: binding.accountKind })
    .onConflictDoNothing();
  const [created] = await tx.select().from(schema.importSources).where(where);
  if (created!.bankAccountId !== accountId) throw new BankError("Die Quelle des Abrufs ist schon mit einem anderen Konto verbunden.");
  return created!;
}

/** Schon übernommene Bewegungen der Lieferung, je `movementKey` */
async function knownMovements(tx: Tx, source: { id: string }, binding: StoreBatchInput["binding"], movements: ImportMovement[]) {
  const ids = [...new Set(movements.map((m) => m.sourceEventId))];
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(schema.importMovements)
          .where(and(eq(schema.importMovements.sourceId, source.id), inArray(schema.importMovements.sourceEventId, ids)));
  return new Map<string, KnownMovement>(
    rows.map((r) => [
      movementKey(binding, { sourceEventId: r.sourceEventId, component: r.component }),
      { core: { amount: r.amount, currency: r.currency, bookingDate: r.bookingDate, kind: r.kind as ImportMovement["kind"] }, details: r.details },
    ]),
  );
}

/** Erstes freies Vorkommen des Dubletten-Hashes, damit ein neuer gleichartiger Umsatz den Index nicht verletzt */
async function freeHash(tx: Tx, accountId: string, row: Row, taken: Set<string>): Promise<string> {
  for (let start = 0; ; start += 20) {
    const candidates = Array.from({ length: 20 }, (_, i) => transactionHash(row, start + i));
    const known = await knownHashes(tx, accountId, candidates);
    const free = candidates.find((h) => !known.has(h) && !taken.has(h));
    if (free) return free;
  }
}

/** Umsätze vor der Bindung mit diesem Hash, die noch keiner Bewegung gehören */
async function aliasCandidates(tx: Tx, accountId: string, source: { createdAt: Date }, hashes: string[]): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.bankTransactions.id, hash: schema.bankTransactions.dedupHash })
    .from(schema.bankTransactions)
    .where(
      and(
        eq(schema.bankTransactions.bankAccountId, accountId),
        inArray(schema.bankTransactions.dedupHash, hashes),
        lt(schema.bankTransactions.createdAt, source.createdAt),
        sql`not exists (select 1 from import_movements m where m.transaction_id = ${schema.bankTransactions.id})`,
      ),
    );
  return new Map(rows.map((r) => [r.hash, r.id]));
}

/**
 * Letzter Buchungstag aus Dateien und FinTS (wie `lastFileBooking` in bank-sync.ts): Diese Tage holt der Abruf absichtlich
 * nicht (`followUpStart`). Ein Umsatz, den die Bank mit so einem Tag vor dem Fenster mitliefert, gehört der Datei.
 */
async function lastOtherBooking(tx: Tx, accountId: string): Promise<string | null> {
  const [row] = await tx
    .select({ date: sql<string | null>`max(${schema.bankTransactions.bookingDate})::text` })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankImports, eq(schema.bankImports.id, schema.bankTransactions.importId))
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), ne(schema.bankImports.format, "enablebanking")));
  return row?.date ?? null;
}

/** Bisheriges Ergebnis einer wiederholten Lieferung, ohne etwas neu zu speichern */
async function replayResult(tx: Tx, account: { id: string; name: string }, previous: typeof schema.importBatches.$inferSelect): Promise<BatchResult> {
  const [imported] = await tx.select().from(schema.bankImports).where(eq(schema.bankImports.id, previous.bankImportId));
  return {
    accountId: account.id,
    accountName: account.name,
    added: 0,
    skipped: (imported?.added ?? 0) + (imported?.skipped ?? 0),
    warnings: imported?.warnings ?? [],
    gap: null,
    quelle: null,
    checkpoint: previous.checkpoint ?? undefined,
    complete: previous.complete,
    replay: true,
  };
}

type Linked = { movement: ImportMovement; hash?: string; transactionId?: string };

/** Welche Umsätze neu angelegt werden und welche Bewegung zu welchem Umsatz gehört (neu oder per Alias) */
async function planRows(
  tx: Tx,
  accountId: string,
  source: { createdAt: Date },
  rows: Row[],
  fresh: Map<string, ImportMovement>,
  eventOf: StoreBatchInput["eventOf"],
  windowFrom: string | undefined,
): Promise<{ insert: Row[]; linked: Linked[]; fileDays: string[] }> {
  const known = await knownHashes(
    tx,
    accountId,
    rows.map((r) => r.dedupHash),
  );
  const aliases = await aliasCandidates(
    tx,
    accountId,
    source,
    rows.filter((r) => fresh.has(eventOf(r) ?? "")).map((r) => r.dedupHash),
  );
  const fileUntil = await lastOtherBooking(tx, accountId);
  const insert: Row[] = [];
  const linked: Linked[] = [];
  const fileDays: string[] = [];
  const taken = new Set<string>();
  for (const row of rows) {
    const event = eventOf(row);
    if (event === undefined) {
      // Ohne stabile Kennung wie bisher: am Inhalt erkannt
      if (!known.has(row.dedupHash) && !taken.has(row.dedupHash)) {
        insert.push(row);
        taken.add(row.dedupHash);
      }
      continue;
    }
    const movement = fresh.get(event);
    // Bekannt, abgelehnt oder schon einmal in dieser Lieferung: kein Umsatz
    if (!movement) continue;
    fresh.delete(event);
    if (windowFrom && fileUntil && movement.bookingDate < windowFrom && movement.bookingDate <= fileUntil) {
      fileDays.push(`${event}: Buchungstag ${movement.bookingDate} vor dem Fenster, den Tag deckt schon eine Datei oder FinTS ab; nicht übernommen.`);
      continue;
    }
    const alias = aliases.get(row.dedupHash);
    if (alias) linked.push({ movement, transactionId: alias });
    else {
      const hash = known.has(row.dedupHash) || taken.has(row.dedupHash) ? await freeHash(tx, accountId, row, taken) : row.dedupHash;
      taken.add(hash);
      insert.push({ ...row, dedupHash: hash });
      linked.push({ movement, hash });
    }
  }

  return { insert, linked, fileDays };
}

/** Lieferung, Abrufstand und Quellenidentitäten festhalten */
async function recordBatch(
  tx: Tx,
  sourceId: string,
  accountId: string,
  validation: Extract<ReturnType<typeof validateBatch>, { ok: true }>,
  importId: string,
  linked: Linked[],
  transactionIds: Map<string, string>,
) {
  const { batch } = validation;
  const parts = await tx
    .select()
    .from(schema.importBatches)
    .where(and(eq(schema.importBatches.sourceId, sourceId), eq(schema.importBatches.fetchId, batch.part.fetchId)));
  // max() übergeht Lieferungen ohne Stand; nach Sortierung kämen sie bei DESC zuerst. Tage, die Umsätze aus anderen Importen
  // (Datei, FinTS, Abruf vor der Bindung) abdecken, zählen als abgerufen: Der Folgeabruf überspringt sie (`followUpStart`)
  const [latest] = await tx
    .select({
      checkpoint: sql<string | null>`greatest(
        (select max(b.checkpoint) from import_batches b where b.source_id = ${sourceId}),
        (select max(t.booking_date) from bank_transactions t where t.bank_account_id = ${accountId}
          and not exists (select 1 from import_batches b where b.bank_import_id = t.import_id)))::text`,
    })
    .from(sql`(select 1) as eins`);
  const progress = advanceCheckpoint(latest?.checkpoint ?? undefined, [
    ...parts.map((p) => ({
      coverage: { from: p.coverageFrom, to: p.coverageTo },
      part: { fetchId: p.fetchId, index: p.partIndex, last: p.partLast },
      blocking: p.blocking,
      ...(p.openFrom ? { openFrom: p.openFrom } : {}),
      conflict: false,
    })),
    {
      coverage: batch.coverage,
      part: batch.part,
      blocking: validation.blocking,
      ...(validation.openFrom ? { openFrom: validation.openFrom } : {}),
      conflict: false,
    },
  ]);
  const [stored] = await tx
    .insert(schema.importBatches)
    .values({
      sourceId: sourceId,
      idempotencyKey: batch.idempotencyKey,
      fetchId: batch.part.fetchId,
      partIndex: batch.part.index,
      partLast: batch.part.last,
      coverageFrom: batch.coverage.from,
      coverageTo: batch.coverage.to,
      blocking: validation.blocking,
      openFrom: validation.openFrom ?? null,
      fingerprint: batchFingerprint(batch),
      bankImportId: importId,
      checkpoint: progress.checkpoint ?? null,
      complete: progress.complete,
    })
    .returning({ id: schema.importBatches.id });
  if (linked.length > 0) {
    await tx.insert(schema.importMovements).values(
      linked.map(({ movement, hash, transactionId }) => ({
        sourceId: sourceId,
        batchId: stored!.id,
        sourceEventId: movement.sourceEventId,
        component: movement.component,
        kind: movement.kind,
        bookingDate: movement.bookingDate,
        amount: movement.amount,
        currency: movement.currency,
        details: knownMovement(movement).details,
        transactionId: transactionId ?? transactionIds.get(hash!)!,
      })),
    );
  }

  return progress;
}

/**
 * Speichert eine Lieferung unter der Sperre des Kontos. Neue Bewegungen werden Umsätze, bekannte übersprungen, Umsätze
 * ohne stabile Kennung wie bisher über den Inhalt erkannt. Danach rückt der Abrufstand der Quelle vor.
 */
export async function storeBatch(tx: Tx, input: StoreBatchInput, accountId: string | null): Promise<BatchResult> {
  const { statement, binding } = input;
  const { account, continuity } = await prepareStatement(tx, statement, input.source.filename, accountId);
  const source = await sourceFor(tx, binding, account.id);
  const validation = validateBatch(input.batch, { ...binding, ...(source.cutoverDate ? { cutoverDate: source.cutoverDate } : {}) });
  if (!validation.ok) throw new BankError(`Abruf nach dem Importvertrag abgelehnt: ${validation.problems.join(" ")}`);
  const { batch } = validation;

  const [previous] = await tx
    .select()
    .from(schema.importBatches)
    .where(and(eq(schema.importBatches.sourceId, source.id), eq(schema.importBatches.idempotencyKey, batch.idempotencyKey)));
  const repeated = classifyBatch(previous, batch);
  if (repeated.outcome === "replay") return replayResult(tx, account, previous!);
  if (repeated.outcome === "conflict") throw new BankError(repeated.message);

  const { results, conflicts } = classifyMovements(await knownMovements(tx, source, binding, validation.accepted), binding, validation.accepted);
  if (conflicts.length > 0) throw new BankError(`Konflikt mit schon übernommenen Umsätzen: ${conflicts.join(" ")}`);
  const fresh = new Map(results.filter((r) => r.outcome === "new").map((r) => [r.movement.sourceEventId, r.movement]));

  // Umsätze in Lieferreihenfolge, damit die Hashes zu denen passen, die der bisherige Weg vergeben hat
  const rows = withDedupHashes(statement.transactions);
  const { insert, linked, fileDays } = await planRows(tx, account.id, source, rows, fresh, input.eventOf, statement.periodFrom);
  const { importId, transactionIds } = await insertStatement(tx, account.id, statement, input.source, insert, rows.length - insert.length);
  const progress = await recordBatch(tx, source.id, account.id, validation, importId, linked, transactionIds);

  const result = await statementResult(tx, account, statement, continuity, insert.length, rows);
  return {
    ...result,
    warnings: [...result.warnings, ...validation.hints, ...validation.rejected.map((r) => `${r.sourceEventId}: ${r.reason}`), ...fileDays],
    checkpoint: progress.checkpoint,
    complete: progress.complete,
    ...(progress.reason ? { reason: progress.reason } : {}),
    replay: false,
  };
}
