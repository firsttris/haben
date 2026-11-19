import { type ImportMovement, type ParsedTransaction, transactionHash } from "@haben/import";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { otherImports } from "./andere-importe.ts";
import { knownHashes } from "./statement-import.ts";

type Row = ParsedTransaction & { dedupHash: string };

/** Erstes freies Vorkommen des Dubletten-Hashes, damit ein neuer gleichartiger Umsatz den Index nicht verletzt */
export async function freeHash(tx: Tx, accountId: string, row: Row, taken: Set<string>): Promise<string> {
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

export type Linked = { movement: ImportMovement; hash?: string; transactionId?: string };

/** Bereits per Referenz erkannte Zahlungen verbrauchen kein Vorkommen für eine zweite, gleichartige Zahlung. */
async function planFallbackRows(tx: Tx, accountId: string, rows: Row[], stableIds: string[], taken: Set<string>) {
  if (rows.length === 0) return { rows: [], observed: [] };
  if (stableIds.length > 0) {
    const stable = await tx
      .select({ hash: schema.bankTransactions.dedupHash })
      .from(schema.bankTransactions)
      .where(and(eq(schema.bankTransactions.bankAccountId, accountId), inArray(schema.bankTransactions.id, [...new Set(stableIds)])));
    for (const { hash } of stable) taken.add(hash);
  }
  const next = new Map<string, number>();
  const candidates = rows.map((row) => {
    const family = transactionHash(row, 0);
    let occurrence = next.get(family) ?? 0;
    let dedupHash = transactionHash(row, occurrence++);
    while (taken.has(dedupHash)) dedupHash = transactionHash(row, occurrence++);
    next.set(family, occurrence);
    return { ...row, dedupHash };
  });
  const known = await knownHashes(
    tx,
    accountId,
    candidates.map((row) => row.dedupHash),
  );
  return { rows: candidates.filter((row) => !known.has(row.dedupHash)), observed: candidates.filter((row) => known.has(row.dedupHash)) };
}

/** Welche Umsätze neu angelegt werden und welche Bewegung zu welchem Umsatz gehört (neu oder per Alias) */
export async function planRows(
  tx: Tx,
  accountId: string,
  source: { createdAt: Date; cutoverDate: string | null },
  rows: Row[],
  fresh: Map<string, ImportMovement>,
  eventOf: (t: ParsedTransaction) => string | undefined,
  windowFrom: string | undefined,
  fallback?: { events: ReadonlySet<string>; accepted: ReadonlySet<string>; stableIds: string[] },
) {
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
  const beforeWindow = (m: ImportMovement) => windowFrom !== undefined && m.bookingDate < windowFrom;
  const inFiles = await otherImports(
    tx,
    accountId,
    [...fresh.values()].filter(beforeWindow).map((m) => m.bookingDate),
    [...aliases.values()],
    // Mit Stichtag nur Dateien nach der Bindung; eine Bindung ohne Stichtag (vor 3b) gleicht wie bisher mit allen ab
    source.cutoverDate ? source.createdAt : undefined,
  );
  const insert: Row[] = [];
  const linked: Linked[] = [];
  const fileDays: string[] = [];
  const taken = new Set<string>();
  const fallbackRows: Row[] = [];
  const observedHashes: Row[] = [];
  for (const row of rows) {
    const event = eventOf(row);
    if (event !== undefined && fallback?.events.has(event)) {
      if (fallback.accepted.has(event)) fallbackRows.push(row);
      continue;
    }
    if (event === undefined) {
      // Sobald auch mehrdeutige Zeilen nach Inhalt abgeglichen werden, müssen beide Wege gemeinsam zählen.
      if (fallback) {
        fallbackRows.push(row);
        continue;
      }
      if (known.has(row.dedupHash)) observedHashes.push(row);
      else if (!taken.has(row.dedupHash)) {
        insert.push(row);
        taken.add(row.dedupHash);
      }
      continue;
    }
    const movement = fresh.get(event);
    // Bekannt, abgelehnt oder schon einmal in dieser Lieferung: kein Umsatz
    if (!movement) continue;
    fresh.delete(event);
    const alias = aliases.get(row.dedupHash);
    const inFile = `${movement.bookingDate}|${movement.amount}`;
    // Vor dem Fenster und an Tag und Betrag schon aus Datei oder FinTS: mit dieser Zeile verbunden, damit sie verbraucht ist
    const fromFile = !alias && beforeWindow(movement) ? inFiles.get(inFile)?.shift() : undefined;
    if (alias) linked.push({ movement, transactionId: alias });
    else if (fromFile) {
      linked.push({ movement, transactionId: fromFile });
      fileDays.push(
        `${event}: Buchungstag ${movement.bookingDate} vor dem Fenster, mit dem Umsatz gleichen Tags und Betrags aus Datei oder FinTS verbunden, nicht neu angelegt.`,
      );
    } else {
      const hash = known.has(row.dedupHash) || taken.has(row.dedupHash) ? await freeHash(tx, accountId, row, taken) : row.dedupHash;
      taken.add(hash);
      insert.push({ ...row, dedupHash: hash });
      linked.push({ movement, hash });
    }
  }

  if (fallback) {
    const stableIds = [...fallback.stableIds, ...linked.flatMap((row) => (row.transactionId ? [row.transactionId] : []))];
    const planned = await planFallbackRows(tx, accountId, fallbackRows, stableIds, taken);
    insert.push(...planned.rows);
    observedHashes.push(...planned.observed);
  }

  return { insert, linked, fileDays, observedHashes };
}
