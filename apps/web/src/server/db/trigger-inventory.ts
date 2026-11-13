import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";
import expected from "./trigger-inventory.json";

type Connection = Pick<Db, "execute">;
type Reader = { transaction<T>(read: (tx: Connection) => Promise<T>, config?: { isolationLevel: "repeatable read"; accessMode: "read only" }): Promise<T> };

export interface TriggerInventory {
  triggers: { table: string; name: string; enabled: string; definition: string; function: string }[];
  functions: { name: string; sourceHash: string; definitionHash: string; config: string[]; language: string; securityDefiner: boolean }[];
}

export interface TriggerProblem {
  art: "sperre";
  tabelle: string;
  zeile: null;
  seq: null;
  befund: string;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * pg_get_triggerdef enthält WHEN, UPDATE OF, Constraintaufschub und Argumente, keine instanzabhängigen OIDs.
 * Ein fester search_path macht darin auch Funktions- und Typnamen eindeutig; die Einstellung gilt nur lokal
 * und wird vor Verlassen der Transaktion zurückgesetzt. Qualifizierte Kataloge verhindern den Vorrang von pg_temp.
 * Auch die Pfadeinstellung selbst darf kein Betreiberobjekt auflösen. Keines der gelesenen Datenbankobjekte wird verändert.
 * https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-SEARCH-PATH
 * https://www.postgresql.org/docs/18/catalog-pg-trigger.html
 * https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-CATALOG-TABLE
 * https://github.com/firsttris/haben/issues/764#issuecomment-6837874131
 */
export async function readTriggerInventory(reader: Reader): Promise<TriggerInventory> {
  return reader.transaction(
    async (tx) => {
      const [setting] = await tx.execute<{ path: string }>(sql`select pg_catalog.current_setting('search_path') as path`);
      await tx.execute(sql`select pg_catalog.set_config('search_path', 'pg_catalog', true)`);
      try {
        const triggers = await tx.execute<TriggerInventory["triggers"][number]>(sql`
        select format('%I.%I', n.nspname, c.relname) as "table", t.tgname as name, t.tgenabled as enabled,
          pg_get_triggerdef(t.oid, false) as definition,
          format('%I.%I(%s)', pn.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as function
        from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_proc p on p.oid = t.tgfoid join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
        where n.nspname = 'public' and not t.tgisinternal order by n.nspname, c.relname, t.tgname`);
        // prosrc ist bei SQL-Standardrümpfen leer; der zusätzliche Definitionshash deckt auch diese ab.
        // proconfig, Sprache und SECURITY DEFINER können die Wirkung ohne Änderung von prosrc verändern.
        // https://www.postgresql.org/docs/18/catalog-pg-proc.html
        const functions = await tx.execute<{
          name: string;
          source: string;
          definition: string;
          config: string[];
          language: string;
          securityDefiner: boolean;
        }>(sql`
        select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as name,
          p.prosrc as source, pg_get_functiondef(p.oid) as definition, coalesce(p.proconfig, '{}'::text[]) as config,
          l.lanname as language, p.prosecdef as "securityDefiner"
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace join pg_catalog.pg_language l on l.oid = p.prolang
        where (n.nspname = 'public' and left(p.proname, 6) = 'haben_')
          or p.oid in (select t.tgfoid from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
            join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace where tn.nspname = 'public' and not t.tgisinternal)
        order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)`);
        return {
          triggers: [...triggers],
          functions: functions.map(({ source, definition, ...fn }) => ({
            ...fn,
            config: [...fn.config].sort(),
            sourceHash: sha256(source),
            definitionHash: sha256(definition),
          })),
        };
      } finally {
        await tx.execute(sql`select pg_catalog.set_config('search_path', ${setting!.path}, true)`);
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Der ausgelieferte Sollbestand stammt aus frischen Testmigrationen, niemals aus der geprüften Instanz. */
export async function checkTriggerIntegrity(reader: Reader): Promise<{ problems: TriggerProblem[]; hints: string[] }> {
  const actual = await readTriggerInventory(reader);
  const problems: TriggerProblem[] = [];
  const hints: string[] = [];
  const problem = (table: string, befund: string) => problems.push({ art: "sperre", tabelle: table.replace(/^public\./, ""), zeile: null, seq: null, befund });
  const key = (trigger: TriggerInventory["triggers"][number]) => `${trigger.table}.${trigger.name}`;
  const triggers = new Map(actual.triggers.map((trigger) => [key(trigger), trigger]));
  const functions = new Map(actual.functions.map((fn) => [fn.name, fn]));
  for (const trigger of expected.triggers) {
    const name = key(trigger);
    const found = triggers.get(name);
    if (!found) {
      problem(trigger.table, `Trigger ${name} fehlt`);
      continue;
    }
    // O feuert im normalen Betrieb, A immer; D ist aus, R feuert nur im Replikat.
    // https://www.postgresql.org/docs/18/catalog-pg-trigger.html
    if (found.enabled !== "O" && found.enabled !== "A")
      problem(trigger.table, `Trigger ${name} ist ${found.enabled === "D" ? "abgeschaltet" : "nur im Replikat aktiv"}`);
    if (found.definition !== trigger.definition || found.function !== trigger.function) problem(trigger.table, `Trigger ${name} wurde verändert`);
    triggers.delete(name);
  }
  for (const fn of expected.functions) {
    const found = functions.get(fn.name);
    const table = expected.triggers.find((trigger) => trigger.function === fn.name)?.table ?? "Funktionen";
    if (!found) problem(table, `Funktion ${fn.name} fehlt`);
    else if (JSON.stringify(found) !== JSON.stringify(fn)) problem(table, `Funktion ${fn.name} wurde verändert`);
  }
  // Eigene Betreibertrigger gehören nicht zum Sollbestand und beweisen keine beschädigte Sperre, auch wenn sie aus sind.
  for (const trigger of triggers.values()) hints.push(`Zusätzlicher Trigger ${key(trigger)}`);
  return { problems, hints };
}

/** Eine Zeile beim Start; Befunde verhindern den Betrieb nicht und werden niemals automatisch repariert. */
export async function logTriggerIntegrity(reader: Reader, write: (line: string) => void = console.info): Promise<void> {
  const result = await checkTriggerIntegrity(reader);
  write(
    `Sperrtrigger: ${result.problems.length} Befunde, ${result.hints.length} Hinweise${result.problems.length + result.hints.length === 0 ? "" : `; ${[...result.problems.map((p) => `${p.tabelle}: ${p.befund}`), ...result.hints].join("; ")}`}`,
  );
}
