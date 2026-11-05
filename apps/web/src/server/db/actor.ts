import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { UserError } from "../errors.ts";
import { db, type Tx } from "./index.ts";

/** Prozessweit statt je Modul: im Build bringen Nitro-Plugin und SSR-Bundle je eine eigene Kopie dieser Datei mit */
const SCOPE = Symbol.for("haben.readOnly");
const store = globalThis as { [SCOPE]?: AsyncLocalStorage<true> };
store[SCOPE] ??= new AsyncLocalStorage<true>();
const readOnlyScope = store[SCOPE];

/** Schreibversuch in einer Anfrage, die nur lesen darf (Rolle Steuerberatung) */
export class ReadOnlyError extends UserError {
  constructor() {
    super("Die Steuerberatung hat nur Lesezugriff.");
  }
}

/**
 * Führt `work` so aus, dass jede Transaktion mit Audit-Akteur abgelehnt wird. Zweite Sicherung hinter der Rechteprüfung der
 * Middleware: rutscht in eine lesende Server Function doch eine Änderung, schreibt sie für die Steuerberatung nichts.
 */
export function runReadOnly<T>(work: () => Promise<T>): Promise<T> {
  return readOnlyScope.run(true, work);
}

/** Ob die laufende Anfrage nur lesen darf, etwa um Aufräumarbeit beim Lesen auszulassen */
export function isReadOnly(): boolean {
  return readOnlyScope.getStore() === true;
}

/** Transaktion, deren Änderungen im Audit-Log dem Nutzer zugeschrieben werden. */
export function withActor<T>(actor: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (isReadOnly()) return Promise.reject(new ReadOnlyError());
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('haben.actor', ${actor}, true)`);
    return work(tx);
  });
}
