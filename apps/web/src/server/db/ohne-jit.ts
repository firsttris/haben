import { sql } from "drizzle-orm";
import { db, type Tx } from "./index.ts";

/**
 * Liest in einer Transaktion ohne JIT-Compiler. Für Abfragen, deren geschätzte Kosten weit über der Ausführung liegen,
 * etwa korrelierte Unterabfragen über alle Archivbelege: Ab jit_above_cost kompiliert PostgreSQL Hunderte Funktionen,
 * das dauert Sekunden, die Abfrage selbst Millisekunden. `set local` gilt nur bis zum Ende der Transaktion und braucht
 * keinen Startparameter, den PgBouncer ablehnen würde.
 */
export function ohneJit<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local jit = off`);
    return work(tx);
  });
}
