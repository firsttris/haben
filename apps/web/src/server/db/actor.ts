import { sql } from "drizzle-orm";
import { db, type Tx } from "./index.ts";

/** Transaktion, deren Änderungen im Audit-Log dem Nutzer zugeschrieben werden. */
export function withActor<T>(actor: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('haben.actor', ${actor}, true)`);
    return work(tx);
  });
}
