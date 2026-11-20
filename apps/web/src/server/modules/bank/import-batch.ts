import { and, arrayOverlaps, eq, inArray, sql } from "drizzle-orm";
import {
  advanceCheckpoint,
  batchFingerprint,
  classifyBatch,
  classifyMovements,
  eventKeyOf,
  type ImportBatch,
  type ImportMovement,
  type KnownMovement,
  knownMovement,
  movementKey,
  parseDate,
  type ParsedStatement,
  type ParsedTransaction,
  type SourceBinding,
  validateBatch,
  withDedupHashes,
} from "@haben/import";
import { schema, type Tx } from "../../db/index.ts";
import { keineExterneQuelle } from "./abruf-bindung.ts";
import { connectedRanges, cutoverFor, otherRanges } from "./andere-importe.ts";
import { type ImportResult, insertStatement, prepareStatement, statementResult } from "./statement-import.ts";
import { BankError } from "./bank-error.ts";
import { recordDuplicateCandidates } from "./duplicate-scan.ts";
import { type Linked, planRows } from "./import-batch-plan.ts";
import { lockImportObservations, recordImportObservations } from "./import-observations.ts";

/*
 * Schritt 3 aus #306: Eine Lieferung des Importvertrags speichern. Bewegungen erkennt Haben an ihrer Quellenidentität
 * (`import_movements`), nicht am Inhalt; `bank_transactions` bleibt, wie es ist, und bekommt weiter einen Dubletten-Hash,
 * damit Datei-Importe die Umsätze erkennen. Mit einer ungültigen Lieferung oder einem Konflikt speichert Haben nichts.
 *
 * Alias (in #306 abgestimmt): Umsätze, die vor der Quellenbindung importiert wurden, kennt `import_movements` nicht.
 * Eine neue Bewegung mit demselben Dubletten-Hash wird mit so einer Zeile verbunden statt neu angelegt, wie es der
 * bisherige Weg getan hätte. Mit Zeilen, die nach der Bindung kamen, gleicht Haben nie über den Inhalt ab.
 */

export { freeHash } from "./import-batch-plan.ts";

/**
 * Schlüssel einer Bewegung unter ihren Umsätzen: die Kennung des Ereignisses, bei einer anderen Komponente als dem
 * Hauptbetrag mit "#<Komponente>" (etwa die Gebühr einer Zahlung von Stripe). `eventOf` eines Adapters liefert zu
 * einem Umsatz denselben Schlüssel; ohne ihn überschriebe die Gebühr den Hauptbetrag desselben Ereignisses.
 */
export const eventKey = eventKeyOf;

export interface StoreBatchInput {
  batch: ImportBatch;
  binding: Omit<SourceBinding, "cutoverDate">;
  /** Derselbe Abruf als Kontoauszug: Zeitraum, Salden und Warnungen fürs Importprotokoll, Umsätze in Lieferreihenfolge */
  statement: ParsedStatement;
  /**
   * Ereignis zu einem Umsatz des Auszugs (`eventKeyOf`: bei einer anderen Komponente als `main` mit ihr dahinter); ohne stabile
   * Kennung undefined, dann erkennt Haben ihn wie bisher am Inhalt
   */
  eventOf: (t: ParsedTransaction) => string | undefined;
  /** Prüfkennungen mehrdeutiger Enable-Banking-Zeilen; nie als Quellenidentität speichern. */
  fallbackEvents?: ReadonlySet<string>;
  source: { filename: string; sha256: string };
  /** „Umsätze abrufen ab“ des Kontos; vor diesem Tag beginnt der Stichtag einer neuen Bindung nie */
  fetchFrom?: string;
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

/**
 * Konflikt mit schon übernommenen Bewegungen (#306, 3b). Trägt sie samt der zuerst übernommenen Bewegung, damit
 * `recordRefusedBatch` genau diese festhält; bei jedem anderen Grund der Ablehnung gibt es keinen Konflikt.
 */
export class MovementConflictError extends BankError {
  readonly conflicts: { movementId: string; movement: ImportMovement }[];

  constructor(message: string, conflicts: { movementId: string; movement: ImportMovement }[]) {
    super(message);
    this.conflicts = conflicts;
  }
}

/**
 * Quellenbindung zur Kennung; fehlt sie, wird sie für dieses Konto mit ihrem Stichtag angelegt. Gehört sie zu einem anderen
 * Konto, Fehler.
 */
async function sourceFor(tx: Tx, binding: StoreBatchInput["binding"], accountId: string, cutover: () => Promise<string>, beforeInsert: () => Promise<void>) {
  const where = and(eq(schema.importSources.provider, binding.provider), eq(schema.importSources.externalAccountId, binding.externalAccountId));
  const [existing] = await tx.select().from(schema.importSources).where(where);
  if (existing) {
    if (existing.bankAccountId !== accountId) throw new BankError("Die Quelle des Abrufs ist schon mit einem anderen Konto verbunden.");
    return existing;
  }
  // Ein Konto, eine Quelle: auch wenn die externe Quelle vor dem Verbinden des Abrufs freigegeben wurde
  await keineExterneQuelle(tx, [accountId]);
  await beforeInsert();
  // Parallel angelegt: der eindeutige Index hält die zweite Bindung ab, dann gilt die erste
  await tx
    .insert(schema.importSources)
    .values({
      bankAccountId: accountId,
      provider: binding.provider,
      externalAccountId: binding.externalAccountId,
      accountKind: binding.accountKind,
      cutoverDate: await cutover(),
    })
    .onConflictDoNothing();
  const [created] = await tx.select().from(schema.importSources).where(where);
  if (created!.bankAccountId !== accountId) throw new BankError("Die Quelle des Abrufs ist schon mit einem anderen Konto verbunden.");
  return created!;
}

/**
 * Schon übernommene Bewegungen der Lieferung, je `movementKey`: zuerst der übernommene Kern, danach die nach einem Konflikt
 * geklärten (`import_resolutions`, #306 3b); dazu die Kennung der übernommenen Bewegung, auf die sich ein Konflikt bezieht.
 */
export async function knownMovements(tx: Tx, source: { id: string }, binding: StoreBatchInput["binding"], movements: ImportMovement[]) {
  const ids = [...new Set(movements.map((m) => m.sourceEventId))];
  const where = and(eq(schema.importMovements.sourceId, source.id), inArray(schema.importMovements.sourceEventId, ids));
  const rows = ids.length === 0 ? [] : await tx.select().from(schema.importMovements).where(where);
  const resolved =
    ids.length === 0
      ? []
      : await tx
          .select({ movementId: schema.importConflicts.movementId, conflict: schema.importConflicts, transactionId: schema.importResolutions.transactionId })
          .from(schema.importConflicts)
          .innerJoin(schema.importResolutions, eq(schema.importResolutions.conflictId, schema.importConflicts.id))
          .innerJoin(schema.importMovements, eq(schema.importMovements.id, schema.importConflicts.movementId))
          .where(where)
          .orderBy(schema.importResolutions.createdAt);
  const core = (r: { amount: number; currency: string; bookingDate: string; kind: string; details: string }): KnownMovement => ({
    core: { amount: r.amount as ImportMovement["amount"], currency: r.currency, bookingDate: r.bookingDate, kind: r.kind as ImportMovement["kind"] },
    details: r.details,
  });
  const known = new Map<string, KnownMovement[]>();
  const origins = new Map<string, (string | null)[]>();
  const movementIds = new Map<string, string>();
  for (const r of rows) {
    const key = movementKey(binding, { sourceEventId: r.sourceEventId, component: r.component });
    known.set(key, [core(r)]);
    origins.set(key, [r.transactionId]);
    movementIds.set(key, r.id);
  }
  const keyOf = new Map(rows.map((r) => [r.id, movementKey(binding, { sourceEventId: r.sourceEventId, component: r.component })]));
  for (const r of resolved) {
    const key = keyOf.get(r.movementId)!;
    known.get(key)?.push(core(r.conflict));
    origins.get(key)?.push(r.transactionId);
  }
  const observedIds = movements.flatMap((m) => {
    const key = movementKey(binding, m);
    const found = known
      .get(key)
      ?.findIndex(({ core: c }) => c.amount === m.amount && c.currency === m.currency && c.bookingDate === m.bookingDate && c.kind === m.kind);
    const id = found === undefined ? undefined : origins.get(key)?.[found];
    return id ? [id] : [];
  });
  return { known, movementIds, observedIds };
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

/** Lieferung, Abrufstand und Quellenidentitäten festhalten */
async function recordBatch(
  tx: Tx,
  sourceId: string,
  accountId: string,
  validation: Extract<ReturnType<typeof validateBatch>, { ok: true }>,
  importId: string,
  linked: Linked[],
  transactionIds: Map<string, string>,
  ambiguousReferences: string[],
) {
  const { batch } = validation;
  const parts = await tx
    .select()
    .from(schema.importBatches)
    .where(and(eq(schema.importBatches.sourceId, sourceId), eq(schema.importBatches.fetchId, batch.part.fetchId)));
  // max() übergeht Lieferungen ohne Stand; nach Sortierung kämen sie bei DESC zuerst
  const [latest] = await tx
    .select({ checkpoint: sql<string | null>`max(${schema.importBatches.checkpoint})::text` })
    .from(schema.importBatches)
    .where(eq(schema.importBatches.sourceId, sourceId));
  // Tage anderer Importe (Datei, FinTS, Abruf vor der Bindung) holt der Folgeabruf nicht noch einmal (`followUpStart`); sie
  // zählen als abgerufen, aber nur, soweit sie lückenlos an dieses Fenster anschließen
  const files = connectedRanges(batch.coverage, await otherRanges(tx, accountId, importId)).map((r, i) => ({
    coverage: r,
    part: { fetchId: `andere-${i}`, index: 0, last: true },
    blocking: 0,
    conflict: false,
  }));
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
    ...files,
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
      ambiguousEntryReferences: ambiguousReferences.length > 0 ? ambiguousReferences : null,
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
        refs: movement.references,
        transactionId: transactionId ?? transactionIds.get(hash!)!,
      })),
    );
  }

  return progress;
}

/** Eine bereits belegte Mehrdeutigkeit gilt auch beim späteren Einzelabruf derselben Quelle. */
async function fallbackFor(tx: Tx, sourceId: string, input: StoreBatchInput, batch: ImportBatch) {
  const events = new Set(input.fallbackEvents);
  const labels = new Map(batch.movements.filter((m) => events.has(m.sourceEventId)).map((m) => [m.sourceEventId, m.references?.providerReference]));
  const observed = [...new Set([...labels.values()].filter((ref): ref is string => ref !== undefined))].sort();
  const references = [...new Set(batch.movements.filter((m) => !events.has(m.sourceEventId)).map((m) => m.sourceEventId))];
  if (batch.provider === "enablebanking" && references.length > 0) {
    const previous = await tx
      .select({ refs: schema.importBatches.ambiguousEntryReferences })
      .from(schema.importBatches)
      .where(and(eq(schema.importBatches.sourceId, sourceId), arrayOverlaps(schema.importBatches.ambiguousEntryReferences, references)));
    const earlier = new Set(previous.flatMap(({ refs }) => refs ?? []));
    for (const ref of references) if (earlier.has(ref)) events.add(ref);
  }
  return { events, labels, observed };
}

/**
 * Speichert eine Lieferung unter der Sperre des Kontos. Neue Bewegungen werden Umsätze, bekannte übersprungen, Umsätze
 * ohne stabile Kennung wie bisher über den Inhalt erkannt. Danach rückt der Abrufstand der Quelle vor.
 */
export async function storeBatch(tx: Tx, input: StoreBatchInput, accountId: string | null): Promise<BatchResult> {
  const { statement, binding } = input;
  const { account, continuity } = await prepareStatement(tx, statement, input.source.filename, accountId);
  const windowFrom = statement.periodFrom ?? input.batch.coverage.from;
  const fromEnableBanking = statement.format === "enablebanking";
  const source = await sourceFor(
    tx,
    binding,
    account.id,
    () => cutoverFor(tx, account.id, windowFrom, input.fetchFrom),
    async () => {
      // Beim ersten Vertragsabruf wird die Quellenbindung selbst auditiert. Mögliche alte Umsätze vorher sperren.
      const days = [...new Set(statement.transactions.map((row) => row.bookingDate).filter((day) => parseDate(day) === day))];
      if (fromEnableBanking) await lockImportObservations(tx, account.id, days);
    },
  );
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

  const ambiguity = await fallbackFor(tx, source.id, input, batch);
  const stable = validation.accepted.filter((m) => !ambiguity.events.has(m.sourceEventId));
  const { known, movementIds, observedIds } = await knownMovements(tx, source, binding, stable);
  const { results, conflicts } = classifyMovements(known, binding, stable);
  if (conflicts.length > 0)
    throw new MovementConflictError(
      `Konflikt mit schon übernommenen Umsätzen: ${conflicts.join(" ")}`,
      results.filter((r) => r.outcome === "conflict").map((r) => ({ movementId: movementIds.get(r.key)!, movement: r.movement })),
    );
  const fresh = new Map(results.filter((r) => r.outcome === "new").map((r) => [eventKey(r.movement), r.movement]));

  // Umsätze in Lieferreihenfolge, damit die Hashes zu denen passen, die der bisherige Weg vergeben hat
  const rows = withDedupHashes(statement.transactions);
  const fallback = fromEnableBanking
    ? {
        events: ambiguity.events,
        accepted: new Set(validation.accepted.filter((m) => ambiguity.events.has(m.sourceEventId)).map((m) => m.sourceEventId)),
        stableIds: observedIds,
      }
    : undefined;
  const { insert, linked, fileDays, observedHashes } = await planRows(tx, account.id, source, rows, fresh, input.eventOf, statement.periodFrom, fallback);
  const existingIds = [...observedIds, ...linked.flatMap((row) => (row.transactionId ? [row.transactionId] : []))];
  const scanDays = fromEnableBanking ? [...new Set(insert.map((row) => row.bookingDate))] : [];
  const observed = fromEnableBanking ? await lockImportObservations(tx, account.id, scanDays, { ids: existingIds, hashes: observedHashes }) : [];
  // Hinweise der Lieferung ins Importprotokoll (bank_imports.warnings), damit sie auch nach dem nächtlichen Abruf zu sehen sind
  const hints = [
    ...validation.hints,
    ...validation.rejected.map((r) => `${ambiguity.labels.get(r.sourceEventId) ?? r.sourceEventId}: ${r.reason}`),
    ...fileDays,
  ];
  const logged = { ...statement, warnings: [...statement.warnings, ...hints] };
  const { importId, transactionIds } = await insertStatement(tx, account.id, logged, input.source, insert, rows.length - insert.length);
  const progress = await recordBatch(tx, source.id, account.id, validation, importId, linked, transactionIds, ambiguity.observed);
  await recordImportObservations(tx, importId, observed);
  if (scanDays.length > 0) {
    const stableIds = new Set(linked.flatMap(({ hash }) => (hash && transactionIds.has(hash) ? [transactionIds.get(hash)!] : [])));
    await recordDuplicateCandidates(tx, account.id, scanDays, new Set(transactionIds.values()), stableIds);
  }

  const result = await statementResult(tx, account, logged, continuity, insert.length, rows);
  return {
    ...result,
    checkpoint: progress.checkpoint,
    complete: progress.complete,
    ...(progress.reason ? { reason: progress.reason } : {}),
    replay: false,
  };
}
