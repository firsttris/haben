import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";

type Connection = Pick<Db, "execute">;

/** Tabellen in public mit eingeschalteter oder erzwungener Zeilensicherheit und alle Policies darauf */
export type RowSecurity = {
  tables: { table: string; enabled: boolean; forced: boolean }[];
  policies: { table: string; name: string; definition: string }[];
};

const byKey = (key: (entry: { table: string; name?: string }) => string) => (a: { table: string; name?: string }, b: { table: string; name?: string }) =>
  key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/*
 * Zeilensicherheit (Row Level Security): Der Eigentümer einer Tabelle kann sie einschalten und mit einer Policy Zeilen vor
 * Rollen verbergen, die nicht Eigentümer sind, also auch vor der App-Anmeldung bei getrennten Rollen. Ein festgeschriebener
 * Datensatz und sein Siegel verschwänden dann aus App und Prüfung, ohne dass haben_integrity_problems etwas meldet; mit
 * FORCE gilt das auch für den Eigentümer. Erwartet search_path = pg_catalog wie die übrigen Abfragen des Sollbestands.
 * https://www.postgresql.org/docs/18/ddl-rowsecurity.html
 * https://www.postgresql.org/docs/18/catalog-pg-policy.html
 */
export async function readRowSecurity(tx: Connection): Promise<RowSecurity> {
  const tables = await tx.execute<RowSecurity["tables"][number]>(sql`
    select format('%I.%I', n.nspname, c.relname) as "table", c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and (c.relrowsecurity or c.relforcerowsecurity)`);
  const policies = await tx.execute<RowSecurity["policies"][number]>(sql`
    select format('%I.%I', n.nspname, c.relname) as "table", p.polname::text as name,
      json_build_array(p.polcmd, p.polpermissive, array(select r::regrole::text from unnest(p.polroles) r order by 1),
        pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))::text as definition
    from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'`);
  // Sortiert ohne Sortierfolge der Datenbank, damit der Sollbestand nicht von ihrer Locale abhängt
  return {
    tables: [...tables].sort(byKey((entry) => entry.table)),
    policies: [...policies].sort(byKey((entry) => `${entry.table}\n${entry.name}`)),
  };
}

/** Befunde je Tabelle: Zeilensicherheit und Policies, die vom Sollbestand abweichen */
export function rowSecurityFindings(expected: RowSecurity, actual: RowSecurity): { table: string; befund: string }[] {
  const findings: { table: string; befund: string }[] = [];
  const short = (table: string) => table.replace(/^public\./, "");
  const flags = (list: RowSecurity["tables"]) => new Map(list.map((entry) => [entry.table, entry]));
  const policyMap = (list: RowSecurity["policies"]) => new Map(list.map((entry) => [`${entry.table}\n${entry.name}`, entry]));
  const [sollFlags, istFlags, sollPolicies, istPolicies] = [
    flags(expected.tables),
    flags(actual.tables),
    policyMap(expected.policies),
    policyMap(actual.policies),
  ];
  const tables = [...new Set([...sollFlags.keys(), ...istFlags.keys(), ...[...sollPolicies.values(), ...istPolicies.values()].map((p) => p.table)])].sort();
  for (const table of tables) {
    const soll = sollFlags.get(table) ?? { enabled: false, forced: false };
    const ist = istFlags.get(table) ?? { enabled: false, forced: false };
    const name = short(table);
    if (ist.enabled !== soll.enabled) findings.push({ table, befund: `Zeilensicherheit auf ${name} ${ist.enabled ? "eingeschaltet" : "abgeschaltet"}` });
    if (ist.forced !== soll.forced) findings.push({ table, befund: `Zeilensicherheit auf ${name} ${ist.forced ? "erzwungen" : "nicht mehr erzwungen"}` });
    const keys = [...new Set([...sollPolicies.keys(), ...istPolicies.keys()])].filter((key) => key.startsWith(`${table}\n`)).sort();
    for (const key of keys) {
      const [sollPolicy, istPolicy] = [sollPolicies.get(key), istPolicies.get(key)];
      const policy = key.slice(table.length + 1);
      if (!sollPolicy) findings.push({ table, befund: `Policy ${policy} auf ${name} angelegt` });
      else if (!istPolicy) findings.push({ table, befund: `Policy ${policy} auf ${name} fehlt` });
      else if (sollPolicy.definition !== istPolicy.definition) findings.push({ table, befund: `Policy ${policy} auf ${name} wurde verändert` });
    }
  }
  return findings;
}
