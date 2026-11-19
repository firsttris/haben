import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type ImportMovement, knownMovement, type ParsedStatement, type ParsedTransaction, type StatementFormat, withDedupHashes } from "@haben/import";
import { withActor } from "../../db/actor.ts";
import { bankAccountIncludedSql, bankOpenAmountSql } from "../../db/bank-open.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { sha256Of } from "../../storage.ts";
import { BankError } from "./bank-error.ts";
import { eventKey, freeHash, MovementConflictError, type StoreBatchInput } from "./import-batch.ts";
import { insertStatement } from "./statement-import.ts";

/*
 * Weg aus einem Konflikt des Importvertrags (#306, 3b, abgestimmt im Issue). Liefert die Bank eine schon übernommene
 * Bewegung mit anderem Kern, nimmt Haben den Abruf des Kontos nicht an (`storeBatch`) und hält den Konflikt hier fest
 * (`import_conflicts`). Der Nutzer entscheidet einmal (`import_resolutions`): Den bisherigen Umsatz behalten, dann gilt
 * der gelieferte Kern künftig als bekannt; oder den gelieferten als weiteren Umsatz übernehmen. Überschrieben wird nie,
 * der bisherige Umsatz bleibt mit seinen Zuordnungen stehen (Unveränderbarkeit nach § 146 Abs. 4 AO). Danach läuft der
 * Abruf des Kontos wieder.
 */

/** Umsatz zu einer Bewegung: der des Auszugs zu ihrem Schlüssel (`eventKey`, auch bei der Gebühr einer Zahlung), sonst aus der Bewegung selbst */
function transactionOf(input: StoreBatchInput, movement: ImportMovement): ParsedTransaction {
  const key = eventKey(movement);
  const row = input.statement.transactions.find((t) => input.eventOf(t) === key);
  if (row) return row;
  return {
    bookingDate: movement.bookingDate,
    ...(movement.valueDate ? { valueDate: movement.valueDate } : {}),
    amount: movement.amount,
    currency: movement.currency,
    counterpartyName: movement.counterpartyName ?? "",
    ...(movement.counterpartyIban ? { counterpartyIban: movement.counterpartyIban } : {}),
    purpose: movement.purpose,
    bankReference: movement.sourceEventId,
    index: 0,
  };
}

/**
 * Ein Abruf, den `storeBatch` abgelehnt hat (Konflikt, ungültige Lieferung), im Importprotokoll des Kontos: ohne Umsätze,
 * ohne Zeitraum und Salden, damit er weder eine Lücke schließt noch einen Kontostand setzt; nur die Meldung. Ein Konflikt
 * mit einer schon übernommenen Bewegung (`MovementConflictError` aus `storeBatch`) kommt dazu nach `import_conflicts`,
 * derselbe gelieferte Kern nur einmal; jeder andere Grund ergibt keinen.
 */
export async function recordRefusedBatch(tx: Tx, accountId: string, input: StoreBatchInput, error: BankError) {
  const { format, currency, accountIban, accountName } = input.statement;
  const empty: ParsedStatement = { format, currency, accountIban, accountName, transactions: [], warnings: [error.message] };
  const { importId } = await insertStatement(tx, accountId, empty, input.source, [], 0);
  const conflicts = error instanceof MovementConflictError ? error.conflicts : [];
  if (conflicts.length === 0) return;
  await tx
    .insert(schema.importConflicts)
    .values(
      conflicts.map(({ movementId, movement }) => ({
        movementId,
        kind: movement.kind,
        bookingDate: movement.bookingDate,
        amount: movement.amount,
        currency: movement.currency,
        details: knownMovement(movement).details,
        transaction: transactionOf(input, movement),
        bankImportId: importId,
      })),
    )
    .onConflictDoNothing();
}

/** Offene Konflikte aller einbezogenen Konten, ältester zuerst, mit dem bisherigen Umsatz und dem gelieferten */
export async function openConflicts() {
  const rows = await db
    .select({
      conflict: schema.importConflicts,
      bankAccountId: schema.importSources.bankAccountId,
      provider: schema.importSources.provider,
      sourceEventId: schema.importMovements.sourceEventId,
      previous: {
        id: schema.bankTransactions.id,
        bookingDate: schema.bankTransactions.bookingDate,
        amount: schema.bankTransactions.amount,
        currency: schema.bankTransactions.currency,
        counterpartyName: schema.bankTransactions.counterpartyName,
        purpose: schema.bankTransactions.purpose,
        open: bankOpenAmountSql.mapWith(Number),
      },
    })
    .from(schema.importConflicts)
    .innerJoin(schema.importMovements, eq(schema.importMovements.id, schema.importConflicts.movementId))
    .innerJoin(schema.importSources, eq(schema.importSources.id, schema.importMovements.sourceId))
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.importMovements.transactionId))
    .leftJoin(schema.importResolutions, eq(schema.importResolutions.conflictId, schema.importConflicts.id))
    .where(and(isNull(schema.importResolutions.id), bankAccountIncludedSql("bank_transactions.bank_account_id")))
    .orderBy(asc(schema.importConflicts.createdAt), asc(schema.importConflicts.id));
  return rows.map((r) => ({
    id: r.conflict.id,
    bankAccountId: r.bankAccountId,
    provider: r.provider,
    sourceEventId: r.sourceEventId,
    since: r.conflict.createdAt.toISOString(),
    previous: r.previous,
    delivered: {
      bookingDate: r.conflict.bookingDate,
      amount: r.conflict.amount,
      currency: r.conflict.currency,
      counterpartyName: r.conflict.transaction.counterpartyName,
      purpose: r.conflict.transaction.purpose,
    },
  }));
}

export const resolveConflictSchema = z.object({ conflictId: z.uuid(), decision: z.enum(["keep", "add"]) });

/**
 * Klärt einen offenen Konflikt unter der Sperre des Kontos, wie ein Abruf. Bei „add“ legt Haben den gelieferten Umsatz
 * so an, wie der Abruf ihn angelegt hätte, in einem eigenen Eintrag des Importprotokolls; einen Dubletten-Hash, den das
 * Konto schon hat, ersetzt das nächste freie Vorkommen.
 */
export async function resolveConflict(actor: string, input: z.infer<typeof resolveConflictSchema>): Promise<{ transactionId: string | null }> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ conflict: schema.importConflicts, accountId: schema.importSources.bankAccountId, sourceEventId: schema.importMovements.sourceEventId })
      .from(schema.importConflicts)
      .innerJoin(schema.importMovements, eq(schema.importMovements.id, schema.importConflicts.movementId))
      .innerJoin(schema.importSources, eq(schema.importSources.id, schema.importMovements.sourceId))
      .where(eq(schema.importConflicts.id, input.conflictId));
    if (!row) throw new BankError("Diesen Konflikt gibt es nicht.");
    const [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, row.accountId)).for("update");
    if (account?.excludedAt) throw new BankError("Das Konto gehört nicht zu dieser Firma; seine Konflikte lassen sich nicht klären.");
    const [done] = await tx.select().from(schema.importResolutions).where(eq(schema.importResolutions.conflictId, input.conflictId));
    if (done) throw new BankError("Dieser Konflikt ist schon geklärt.");
    let transactionId: string | null = null;
    if (input.decision === "add") {
      const [refused] = await tx
        .select({ format: schema.bankImports.format })
        .from(schema.bankImports)
        .where(eq(schema.bankImports.id, row.conflict.bankImportId));
      const [delivered] = withDedupHashes([row.conflict.transaction]);
      const fresh = { ...delivered!, dedupHash: await freeHash(tx, row.accountId, delivered!, new Set()) };
      const statement: ParsedStatement = {
        format: refused!.format as StatementFormat,
        currency: row.conflict.currency,
        transactions: [fresh],
        warnings: [`${row.sourceEventId}: nach dem Konflikt als weiterer Umsatz übernommen; der bisherige bleibt.`],
      };
      const source = { filename: `Klärung ${row.sourceEventId}`, sha256: sha256Of(Buffer.from(`klaerung:${row.conflict.id}`, "utf8")) };
      const { transactionIds } = await insertStatement(tx, row.accountId, statement, source, [fresh], 0);
      transactionId = transactionIds.get(fresh.dedupHash) ?? null;
    }
    await tx.insert(schema.importResolutions).values({ conflictId: input.conflictId, decision: input.decision, transactionId, createdBy: actor });
    return { transactionId };
  });
}

/**
 * Hinweis an einem Umsatz aus einer Klärung, abgeleitet aus `import_resolutions` (keine Spalte in `bank_transactions`):
 * am bisherigen die weiteren Umsätze, die Haben nach einem Konflikt übernommen hat; am weiteren der bisherige. Null ohne Bezug.
 */
export async function klaerungView(transactionId: string) {
  const previous = sql`(select m.transaction_id from import_movements m where m.id = ${schema.importConflicts.movementId})`;
  const provider = sql`(select s.provider from import_movements m join import_sources s on s.id = m.source_id where m.id = ${schema.importConflicts.movementId})`;
  const rows = await db
    .select({
      previous: sql<string>`${previous}`,
      provider: sql<string>`${provider}`,
      added: schema.importResolutions.transactionId,
      at: schema.importResolutions.createdAt,
    })
    .from(schema.importResolutions)
    .innerJoin(schema.importConflicts, eq(schema.importConflicts.id, schema.importResolutions.conflictId))
    .where(
      and(eq(schema.importResolutions.decision, "add"), or(eq(schema.importResolutions.transactionId, transactionId), sql`${previous} = ${transactionId}`)),
    )
    .orderBy(asc(schema.importResolutions.createdAt));
  if (rows.length === 0) return null;
  const other = async (id: string) => {
    const [t] = await db
      .select({ id: schema.bankTransactions.id, bookingDate: schema.bankTransactions.bookingDate, amount: schema.bankTransactions.amount })
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.id, id));
    return t!;
  };
  return {
    /** Wer anders geliefert hat (Anbieter der Quelle): ein Konto hat genau eine Quelle */
    provider: rows[0]!.provider,
    /** Weitere Umsätze, die nach einem Konflikt zu diesem übernommen wurden */
    added: await Promise.all(rows.filter((r) => r.previous === transactionId).map((r) => other(r.added!))),
    /** Der bisherige Umsatz, wenn dieser aus einer Klärung stammt */
    previous: rows.find((r) => r.added === transactionId) ? await other(rows.find((r) => r.added === transactionId)!.previous) : null,
  };
}
