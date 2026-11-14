import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";

/**
 * Dauerhafte Vorgaben wirken wie abgeschaltete normale Trigger. Nur SET in einer Sitzung ist keine solche Vorgabe.
 * reset_val erfasst auch die geladene Serverkonfiguration; Rollen-/Datenbankvorgaben stehen im gemeinsamen Katalog.
 * local feuert dieselben Trigger wie origin und ist deshalb kein Befund.
 * https://www.postgresql.org/docs/18/catalog-pg-db-role-setting.html
 * https://www.postgresql.org/docs/18/view-pg-settings.html
 * https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE
 */
export async function replicationDefaults(connection: Pick<Db, "execute">): Promise<string[]> {
  const settings = await connection.execute<{ scope: string }>(sql`
    select 'Vorgabe der Verbindung' as scope from pg_catalog.pg_settings
    where name = 'session_replication_role' and reset_val = 'replica'
    union all
    select case when s.setrole = 0 then 'Datenbank ' || pg_catalog.current_database()
      else 'Rolle ' || pg_catalog.quote_ident(r.rolname) ||
        case when s.setdatabase = 0 then ' (alle Datenbanken)' else ' in Datenbank ' || pg_catalog.current_database() end end as scope
    from pg_catalog.pg_db_role_setting s left join pg_catalog.pg_roles r on r.oid = s.setrole
    cross join lateral pg_catalog.unnest(s.setconfig) as config(value)
    where s.setdatabase in (0, (select oid from pg_catalog.pg_database where datname = pg_catalog.current_database()))
      and pg_catalog.split_part(config.value, '=', 1) = 'session_replication_role'
      and pg_catalog.lower(pg_catalog.split_part(config.value, '=', 2)) = 'replica'
    order by scope`);
  return settings.map(({ scope }) => `Dauerhafte Voreinstellung session_replication_role = replica (${scope}); normale Trigger werden nicht ausgeführt`);
}
