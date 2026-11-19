// Kontoauszüge importieren und speichern: Saldenfolge, Dubletten, Importprotokoll

import { BankError } from "./bank-error.ts";
import {
  checkBalanceContinuity,
  parseStatement,
  StatementParseError,
  withDedupHashes,
  type BankCsvMapping,
  type ParsedStatement,
  type ParsedTransaction,
} from "@haben/import";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { importAccount } from "./import-konto.ts";
import { recordDuplicateCandidates } from "./duplicate-scan.ts";
import { lockImportObservations, recordImportObservations } from "./import-observations.ts";
import { schema, type Tx } from "../../db/index.ts";
import { sha256Of } from "../../storage.ts";
import { quellenHinweis } from "./quellen.ts";
import { echterImport, normalizeIban } from "./accounts.ts";

/** Eine CSV, die keiner bekannten Bank gehört; die Seite bietet dann die Spaltenzuordnung an (#1275) */
export class UnbekannteCsvError extends BankError {}

export interface ImportResult {
  accountId: string;
  accountName: string;
  added: number;
  skipped: number;
  warnings: string[];
  gap: string | null;
  /** Meldung, wenn im Zeitraum schon Umsätze aus einem anderen Dateiformat liegen (#632) */
  quelle: string | null;
}

/**
 * Importiert eine Kontoauszugsdatei. Bereits vorhandene Umsätze (gleicher Hash) werden übersprungen,
 * eine Lücke zum vorigen Import wird gemeldet.
 */
export async function importStatement(actor: string, file: { bytes: Uint8Array; filename: string }, accountId: string | null): Promise<ImportResult> {
  let statement;
  try {
    statement = parseStatement(file.bytes, file.filename);
  } catch (error) {
    if (error instanceof StatementParseError) throw new BankError(`${file.filename}: ${error.message}`);
    throw error;
  }
  return withActor(actor, (tx) => storeStatement(tx, statement, { filename: file.filename, sha256: sha256Of(file.bytes) }, accountId));
}

/**
 * Speichert einen Kontoauszug, egal ob aus einer Datei oder vom automatischen Abruf. Ohne `accountId`
 * wird das Konto über die IBAN gefunden oder angelegt.
 */
export async function storeStatement(
  tx: Tx,
  statement: ParsedStatement,
  source: { filename: string; sha256: string; csvMapping?: BankCsvMapping },
  accountId: string | null,
): Promise<ImportResult> {
  const { account, continuity } = await prepareStatement(tx, statement, source.filename, accountId);
  const transactions = withDedupHashes(statement.transactions);
  const known = await knownHashes(
    tx,
    account.id,
    transactions.map((t) => t.dedupHash),
  );
  const fresh = transactions.filter((t) => !known.has(t.dedupHash));
  const fromEnableBanking = statement.format === "enablebanking";
  const scanDays = fromEnableBanking ? [...new Set(fresh.map((row) => row.bookingDate))] : [];
  const observed = fromEnableBanking
    ? await lockImportObservations(tx, account.id, scanDays, { hashes: transactions.filter((row) => known.has(row.dedupHash)) })
    : [];
  const { importId, transactionIds } = await insertStatement(tx, account.id, statement, source, fresh, transactions.length - fresh.length);
  await recordImportObservations(tx, importId, observed);
  // Ohne Quellenbindung ist auch eine innerhalb des Abrufs eindeutige Referenz kein Beleg über mehrere Abrufe.
  await recordDuplicateCandidates(tx, account.id, scanDays, new Set(transactionIds.values()), new Set());
  return statementResult(tx, account, statement, continuity, fresh.length, transactions);
}

/** Konto finden, Saldenfolge zum vorigen Import prüfen und das Konto sperren, damit parallele Importe nichts doppelt anlegen */
export async function prepareStatement(tx: Tx, statement: ParsedStatement, filename: string, accountId: string | null) {
  const account = await importAccount(tx, statement, filename, accountId);

  const [previous] = await tx
    .select({ closingBalance: schema.bankImports.closingBalance, periodTo: schema.bankImports.periodTo })
    .from(schema.bankImports)
    .where(
      and(
        eq(schema.bankImports.bankAccountId, account.id),
        echterImport,
        statement.periodFrom ? lte(schema.bankImports.periodTo, statement.periodFrom) : sql`true`,
      ),
    )
    .orderBy(desc(schema.bankImports.periodTo), desc(schema.bankImports.createdAt))
    .limit(1);
  const continuity = checkBalanceContinuity(
    previous ? { closingBalance: previous.closingBalance ?? undefined, periodTo: previous.periodTo ?? undefined } : null,
    { openingBalance: statement.openingBalance, periodFrom: statement.periodFrom },
  );

  // Konto sperren, damit parallele Importe dieselben Umsätze nicht doppelt anlegen
  const [locked] = await tx
    .select({ excludedAt: schema.bankAccounts.excludedAt })
    .from(schema.bankAccounts)
    .where(eq(schema.bankAccounts.id, account.id))
    .for("update");
  if (!locked || locked.excludedAt) throw new BankError("Das Konto ist ausgeschlossen oder nicht mehr vorhanden.");
  return { account, continuity };
}

/** Dubletten-Hashes, die das Konto schon hat */
export async function knownHashes(tx: Tx, accountId: string, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await tx
    .select({ hash: schema.bankTransactions.dedupHash })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), inArray(schema.bankTransactions.dedupHash, hashes)));
  return new Set(rows.map((r) => r.hash));
}

/** Importprotokoll und neue Umsätze schreiben; liefert die Kennung des Imports und je Dubletten-Hash den neuen Umsatz */
export async function insertStatement(
  tx: Tx,
  accountId: string,
  statement: ParsedStatement,
  source: { filename: string; sha256: string; csvMapping?: BankCsvMapping },
  fresh: (ParsedTransaction & { dedupHash: string })[],
  skipped: number,
): Promise<{ importId: string; transactionIds: Map<string, string> }> {
  const [imported] = await tx
    .insert(schema.bankImports)
    .values({
      bankAccountId: accountId,
      filename: source.filename.slice(0, 200),
      sha256: source.sha256,
      format: statement.format,
      periodFrom: statement.periodFrom ?? null,
      periodTo: statement.periodTo ?? null,
      openingBalance: statement.openingBalance ?? null,
      closingBalance: statement.closingBalance ?? null,
      added: fresh.length,
      skipped,
      warnings: statement.warnings,
      csvMapping: source.csvMapping ?? null,
    })
    .returning();
  const transactionIds = new Map<string, string>();
  if (fresh.length > 0) {
    const rows = await tx
      .insert(schema.bankTransactions)
      .values(
        fresh.map((t) => ({
          bankAccountId: accountId,
          importId: imported!.id,
          bookingDate: t.bookingDate,
          valueDate: t.valueDate ?? null,
          amount: t.amount,
          currency: t.currency,
          counterpartyName: t.counterpartyName,
          counterpartyIban: t.counterpartyIban ? normalizeIban(t.counterpartyIban) : null,
          purpose: t.purpose,
          type: t.type ?? null,
          bankReference: t.bankReference ?? null,
          endToEndId: t.endToEndId ?? null,
          dedupHash: t.dedupHash,
        })),
      )
      .returning({ id: schema.bankTransactions.id, hash: schema.bankTransactions.dedupHash });
    for (const r of rows) transactionIds.set(r.hash, r.id);
  }
  return { importId: imported!.id, transactionIds };
}

/** Ergebnis eines gespeicherten Auszugs für die Oberfläche */
export async function statementResult(
  tx: Tx,
  account: { id: string; name: string },
  statement: ParsedStatement,
  continuity: { ok: boolean; message?: string },
  added: number,
  transactions: (ParsedTransaction & { dedupHash: string })[],
): Promise<ImportResult> {
  return {
    accountId: account.id,
    accountName: account.name,
    added,
    skipped: transactions.length - added,
    warnings: statement.warnings,
    gap: continuity.ok ? null : (continuity.message ?? "Lücke zum vorigen Import"),
    quelle: await quellenHinweis(tx, account.id, statement.format, added, statement.periodFrom, statement.periodTo, transactions),
  };
}
