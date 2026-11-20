import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";

type Connection = Pick<Db, "execute">;

/** Standardwert einer Spalte, als Ausdruck wie von pg_get_expr ausgegeben */
export type ColumnDefault = { table: string; column: string; expression: string };

/**
 * Tabellen, die in ein Siegel eingehen (#1580): jede mit einem Trigger auf haben_seal() und die Kindtabellen, die
 * haben_seal_columns für sie nennt. Nur für den Generator auf einer frisch migrierten Datenbank: Die Prüfung einer
 * Instanz nimmt die Tabellen aus dem ausgelieferten Sollbestand, sonst bestimmte eine veränderte Funktion den Umfang.
 * Erwartet search_path = public, weil haben_seal_columns haben_columns ohne Schema aufruft.
 */
export async function sealedTables(tx: Connection): Promise<string[]> {
  const rows = await tx.execute<{ table: string }>(sql`
    select distinct pg_catalog.format('%I.%I', 'public', part.name) collate pg_catalog."C" as "table"
    from (select distinct c.relname from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = t.tgfoid join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
      where n.nspname = 'public' and pn.nspname = 'public' and p.proname = 'haben_seal' and not t.tgisinternal) sealed
    cross join lateral pg_catalog.jsonb_object_keys(public.haben_seal_columns(sealed.relname::text)) part(name)
    order by 1`);
  return rows.map((row) => row.table);
}

/**
 * Standardwerte der Spalten der genannten Tabellen aus dem Katalog. An ihnen misst haben_integrity_problems, was ein
 * älteres Siegel nicht abdeckt (0310_siegel_unabgedeckte_spalten.sql). Erwartet search_path = pg_catalog wie die
 * Triggerdefinitionen, damit Typnamen im Ausdruck eindeutig sind. Erzeugte Spalten stehen auch in pg_attrdef, sind
 * aber kein Standardwert.
 * https://www.postgresql.org/docs/18/catalog-pg-attrdef.html
 * https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-CATALOG-TABLE
 */
export async function columnDefaults(tx: Connection, tables: string[]): Promise<ColumnDefault[]> {
  const rows = await tx.execute<ColumnDefault>(sql`
    select format('%I.%I', n.nspname, c.relname) as "table", a.attname as "column", pg_get_expr(d.adbin, d.adrelid) as expression
    from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    join pg_catalog.pg_class c on c.oid = d.adrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not a.attisdropped and a.attgenerated = ''
    order by n.nspname, c.relname, a.attname`);
  const wanted = new Set(tables);
  return rows.filter((row) => wanted.has(row.table));
}
