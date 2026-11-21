import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";

type Connection = Pick<Db, "execute">;

/** Tabellen in public mit eingeschalteter oder erzwungener Zeilensicherheit und die Policies darauf */
export type RowSecurity = {
  tables: { table: string; enabled: boolean; forced: boolean }[];
  policies: { table: string; name: string }[];
};

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/*
 * Zeilensicherheit (Row Level Security): Der Eigentümer einer Tabelle kann sie einschalten und mit einer Policy Zeilen vor
 * Rollen verbergen, die nicht Eigentümer sind, also auch vor der App-Anmeldung bei getrennten Rollen. Ein festgeschriebener
 * Datensatz und sein Siegel verschwänden dann aus der App und aus den Prüfungen, die von Datensätzen oder Siegeln ausgehen;
 * mit FORCE gilt das auch für den Eigentümer. Das fehlende Siegel fällt haben_integrity_problems nur noch am Eintrag im
 * Audit-Log auf (0311). Haben nutzt keine Zeilensicherheit, deshalb ist jede ein Befund.
 * Erwartet search_path = pg_catalog wie die übrigen Abfragen des Sollbestands.
 * https://www.postgresql.org/docs/18/ddl-rowsecurity.html
 * https://www.postgresql.org/docs/18/catalog-pg-policy.html
 */
export async function readRowSecurity(tx: Connection): Promise<RowSecurity> {
  const tables = await tx.execute<RowSecurity["tables"][number]>(sql`
    select c.relname::text as "table", c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and (c.relrowsecurity or c.relforcerowsecurity)`);
  const policies = await tx.execute<RowSecurity["policies"][number]>(sql`
    select c.relname::text as "table", p.polname::text as name
    from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'`);
  return { tables: [...tables], policies: [...policies] };
}

/** Befunde je Tabelle, nach Tabelle sortiert, je Tabelle die Zeilensicherheit vor den Policies */
export function rowSecurityFindings(found: RowSecurity): { table: string; befund: string }[] {
  const tables = [...new Set([...found.tables.map((entry) => entry.table), ...found.policies.map((entry) => entry.table)])].sort(byName);
  return tables.flatMap((table) => {
    const flags = found.tables.find((entry) => entry.table === table);
    const policies = found.policies
      .filter((entry) => entry.table === table)
      .map((entry) => entry.name)
      .sort(byName);
    return [
      ...(flags?.enabled ? [{ table, befund: `Zeilensicherheit auf ${table} eingeschaltet` }] : []),
      ...(flags?.forced ? [{ table, befund: `Zeilensicherheit auf ${table} erzwungen` }] : []),
      ...policies.map((name) => ({ table, befund: `Policy ${name} auf ${table} angelegt` })),
    ];
  });
}
