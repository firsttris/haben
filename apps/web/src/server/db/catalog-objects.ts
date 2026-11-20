import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";

type Connection = Pick<Db, "execute">;

/** Selbst angelegte Funktion, Aggregat, Prozedur oder Operator in public oder pg_catalog */
type Named = { name: string; schema: string; proname: string; builtin: boolean };

export interface CatalogObjects {
  functions: Named[];
  operators: Named[];
  casts: string[];
}

/*
 * Objekte, die jemand angelegt hat und die keine Erweiterung mitbringt. Die Prüffunktionen rufen eingebaute Funktionen
 * ohne Schema auf. Eine Funktion mit genau passenden Argumenttypen geht dabei einer polymorphen vor, egal in welchem Schema
 * des Suchpfads sie steht; ein Superuser kann sie auch in pg_catalog anlegen. Ein Cast in json ändert, was to_jsonb aus
 * einem eigenen Typ macht. Selbst angelegte Objekte haben eine OID ab FirstNormalObjectId (16384), eingebaute darunter.
 * Erwartet search_path = pg_catalog wie die übrigen Abfragen des Sollbestands.
 * https://www.postgresql.org/docs/18/typeconv-func.html
 * https://www.postgresql.org/docs/18/functions-json.html (to_jsonb)
 * https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/access/transam.h (FirstNormalObjectId)
 */
export async function readCatalogObjects(tx: Connection): Promise<CatalogObjects> {
  const functions = await tx.execute<Named>(sql`
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as name, n.nspname as schema,
      p.proname::text as proname, exists (select 1 from pg_catalog.pg_proc b where b.oid < 16384 and b.proname = p.proname) as builtin
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.oid >= 16384 and n.nspname in ('public', 'pg_catalog')
      and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e')
    order by 1`);
  const operators = await tx.execute<Named>(sql`
    select format('%I.%s(%s, %s)', n.nspname, o.oprname, case when o.oprleft = 0 then 'NONE' else format_type(o.oprleft, null) end,
        format_type(o.oprright, null)) as name, n.nspname as schema, o.oprname::text as proname,
      exists (select 1 from pg_catalog.pg_operator b where b.oid < 16384 and b.oprname = o.oprname) as builtin
    from pg_catalog.pg_operator o join pg_catalog.pg_namespace n on n.oid = o.oprnamespace
    where o.oid >= 16384 and n.nspname in ('public', 'pg_catalog')
      and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_operator'::pg_catalog.regclass and d.objid = o.oid and d.deptype = 'e')
    order by 1`);
  const casts = await tx.execute<{ name: string }>(sql`
    select format('%s → %s', format_type(c.castsource, null), format_type(c.casttarget, null)) as name
    from pg_catalog.pg_cast c
    where c.oid >= 16384
      and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_cast'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e')
    order by 1`);
  return { functions: [...functions], operators: [...operators], casts: casts.map((cast) => cast.name) };
}

/**
 * Befunde und Hinweise zu fremden Objekten. `schemas` ist current_schemas(true) der prüfenden Verbindung, gelesen vor dem
 * Umstellen des Suchpfads; `expected` sind die Funktionen des Sollbestands. Eine Funktion oder ein Operator mit eigenem
 * Namen kann keinen Aufruf von Haben übernehmen und ist wie ein zusätzlicher Trigger nur ein Hinweis.
 */
export function catalogFindings(objects: CatalogObjects, schemas: string[], expected: string[]): { problems: string[]; hints: string[] } {
  const problems: string[] = [];
  const hints: string[] = [];
  const own = new Set(expected);
  const ownNames = new Set(expected.map((name) => name.slice(name.indexOf(".") + 1, name.indexOf("("))));
  const judge = (label: string, same: string, entry: Named, collides: boolean) => {
    if (entry.schema === "pg_catalog") problems.push(`${label} ${entry.name} im Systemschema pg_catalog`);
    else if (collides) problems.push(`${label} ${entry.name} überdeckt ${same}`);
    else hints.push(`${label} ${entry.name}`);
  };
  for (const fn of objects.functions) {
    if (!own.has(fn.name)) judge("Zusätzliche Funktion", "eine gleichnamige Funktion", fn, fn.builtin || ownNames.has(fn.proname));
  }
  for (const operator of objects.operators) judge("Zusätzlicher Operator", "einen gleichnamigen Operator", operator, operator.builtin);
  for (const cast of objects.casts) problems.push(`Zusätzlicher Cast ${cast}`);
  // Vor public liest PostgreSQL pg_catalog und, wenn es existiert, das Schema mit dem Namen der Anmeldung ("$user")
  // https://www.postgresql.org/docs/18/ddl-schemas.html#DDL-SCHEMAS-PATH
  const path = schemas.filter((schema) => !schema.startsWith("pg_temp"));
  for (const schema of path) if (schema !== "pg_catalog" && schema !== "public") problems.push(`Schema ${schema} im Suchpfad der Verbindung`);
  if (path[0] !== "pg_catalog") problems.push("pg_catalog steht im Suchpfad der Verbindung nicht vorn");
  return { problems, hints };
}
