import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./index.ts";

type Connection = Pick<Db, "execute">;

/** Name und Hash über die Definition */
export type Entry = { name: string; hash: string };

/** Selbst angelegte Funktion, Aggregat, Prozedur, Operator oder Cast */
type Found = Entry & { schema: string; proname: string; builtin: boolean; extension: boolean };

export interface CatalogObjects {
  functions: Found[];
  operators: Found[];
  casts: Found[];
  /** Relationen in pg_catalog und gleichnamige zu Tabellen in public im temporären Schema der Sitzung */
  relations: { name: string; schema: string }[];
}

/** Mitglieder der Erweiterungen einer frischen Installation (pg_trgm, unaccent) */
export type Extensions = { functions: Entry[]; operators: Entry[]; casts: Entry[] };

const digest = (definition: object) => createHash("sha256").update(JSON.stringify(definition)).digest("hex");
// Sortiert ohne Sortierfolge der Datenbank, damit der Sollbestand nicht von ihrer Locale abhängt
const byName = (a: Entry, b: Entry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const withHash = <T extends { name: string }>(rows: T[], keys: (keyof T)[]) =>
  rows.map((row) => {
    const definition = Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key as keyof T)));
    return { ...row, hash: digest(definition) };
  });

/**
 * Definition einer Funktion für den Hash. Einen Rumpf in SQL-Standard-Schreibweise (RETURN, BEGIN ATOMIC) hat prosrc nicht,
 * er steht in prosqlbody. https://www.postgresql.org/docs/18/catalog-pg-proc.html
 */
const functionDefinition = sql`p.prokind, l.lanname, p.prosecdef, p.proleakproof, p.proisstrict, p.proretset, p.provolatile,
  p.proparallel, format_type(p.prorettype, null) as rettype, p.prosrc, p.probin, pg_get_function_sqlbody(p.oid) as sqlbody,
  coalesce(p.proconfig, '{}'::text[]) as config`;
const member = (catalog: string, column: string) =>
  sql.raw(`exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.${catalog}'::pg_catalog.regclass
    and d.objid = ${column} and d.deptype = 'e')`);

/*
 * Objekte, die jemand angelegt hat. Die Prüffunktionen rufen eingebaute Funktionen ohne Schema auf. Eine Funktion mit genau
 * passenden Argumenttypen geht dabei einer polymorphen vor, egal in welchem Schema des Suchpfads sie steht; ein Superuser
 * kann sie auch in pg_catalog anlegen. Ein Cast in json ändert, was to_jsonb aus einem eigenen Typ macht. Selbst angelegte
 * Objekte haben eine OID ab FirstNormalObjectId (16384), eingebaute darunter. Mitglied einer Erweiterung zu sein, belegt
 * keine Herkunft: Ihr Eigentümer kann jedes eigene Objekt aufnehmen (ALTER EXTENSION … ADD). Deshalb lesen die Abfragen
 * auch Mitglieder, mit einem Hash über ihre Definition für den Vergleich mit dem Sollbestand.
 * Erwartet search_path = pg_catalog wie die übrigen Abfragen des Sollbestands.
 * https://www.postgresql.org/docs/18/typeconv-func.html
 * https://www.postgresql.org/docs/18/functions-json.html (to_jsonb)
 * https://www.postgresql.org/docs/18/sql-alterextension.html
 * https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/access/transam.h (FirstNormalObjectId)
 */
export async function readCatalogObjects(tx: Connection): Promise<CatalogObjects> {
  const keys = ["name", "schema", "proname", "builtin", "extension"] as const;
  const functions = await tx.execute<Omit<Found, "hash">>(sql`
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as name, n.nspname as schema,
      p.proname::text as proname, exists (select 1 from pg_catalog.pg_proc b where b.oid < 16384 and b.proname = p.proname) as builtin,
      ${member("pg_proc", "p.oid")} as extension, ${functionDefinition}
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid >= 16384 and n.nspname in ('public', 'pg_catalog')`);
  const operators = await tx.execute<Omit<Found, "hash">>(sql`
    select format('%I.%s(%s, %s)', n.nspname, o.oprname, case when o.oprleft = 0 then 'NONE' else format_type(o.oprleft, null) end,
        format_type(o.oprright, null)) as name, n.nspname as schema, o.oprname::text as proname,
      exists (select 1 from pg_catalog.pg_operator b where b.oid < 16384 and b.oprname = o.oprname) as builtin,
      ${member("pg_operator", "o.oid")} as extension, format_type(o.oprresult, null) as result, o.oprcode::regprocedure::text as code,
      o.oprcom::regoperator::text as commutator, o.oprnegate::regoperator::text as negator, o.oprrest::text as restrict, o.oprjoin::text as join
    from pg_catalog.pg_operator o join pg_catalog.pg_namespace n on n.oid = o.oprnamespace
    where o.oid >= 16384 and n.nspname in ('public', 'pg_catalog')`);
  const casts = await tx.execute<Omit<Found, "hash">>(sql`
    select format('%s → %s', format_type(c.castsource, null), format_type(c.casttarget, null)) as name, '' as schema, '' as proname,
      false as builtin, ${member("pg_cast", "c.oid")} as extension, c.castfunc::regprocedure::text as function, c.castcontext, c.castmethod
    from pg_catalog.pg_cast c
    where c.oid >= 16384`);
  // Die Prüffunktionen nennen auch Tabellen ohne Schema. Für Relationen stehen das temporäre Schema der Sitzung und
  // pg_catalog im Suchpfad vor public; nach pg_catalog kann ein Superuser eine Sicht mit SET SCHEMA verschieben.
  const relations = await tx.execute<{ name: string; schema: string }>(sql`
    select format('%I.%I', n.nspname, c.relname) as name, n.nspname::text as schema
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.oid >= 16384 and (n.nspname = 'pg_catalog' or (c.relnamespace = pg_my_temp_schema() and exists (
      select 1 from pg_catalog.pg_class p join pg_catalog.pg_namespace pn on pn.oid = p.relnamespace where pn.nspname = 'public' and p.relname = c.relname)))
    order by c.oid`);
  const sorted = (rows: Omit<Found, "hash">[]) => withHash(rows, [...keys]).sort(byName);
  return { functions: sorted([...functions]), operators: sorted([...operators]), casts: sorted([...casts]), relations: [...relations] };
}

/** Mitglieder von Erweiterungen, für den Sollbestand aus einer frisch migrierten Datenbank */
export function extensionMembers(objects: CatalogObjects): Extensions {
  const entries = (list: Found[]) => list.filter((entry) => entry.extension).map(({ name, hash }) => ({ name, hash }));
  return { functions: entries(objects.functions), operators: entries(objects.operators), casts: entries(objects.casts) };
}

/**
 * Befunde und Hinweise zu fremden Objekten. `schemas` ist current_schemas(true) der prüfenden Verbindung, gelesen vor dem
 * Umstellen des Suchpfads, `temp` ihr temporäres Schema (pg_my_temp_schema); `functions` sind die Funktionen des
 * Sollbestands, `extensions` die Mitglieder der Erweiterungen einer frischen Installation. Eine Funktion oder ein Operator mit
 * eigenem Namen kann keinen Aufruf von Haben übernehmen und ist wie ein zusätzlicher Trigger nur ein Hinweis.
 */
export function catalogFindings(
  objects: CatalogObjects,
  expected: { schemas: string[]; temp: string | null; functions: string[]; extensions: Extensions },
): { problems: string[]; hints: string[] } {
  const problems: string[] = [];
  const hints: string[] = [];
  const own = new Set(expected.functions);
  const ownNames = new Set(expected.functions.map((name) => name.slice(name.indexOf(".") + 1, name.indexOf("("))));
  const known = (list: Entry[]) => new Set(list.map((entry) => `${entry.name}\n${entry.hash}`));
  const members = { functions: known(expected.extensions.functions), operators: known(expected.extensions.operators), casts: known(expected.extensions.casts) };
  const shipped = (set: Set<string>, entry: Found) => entry.extension && set.has(`${entry.name}\n${entry.hash}`);
  const judge = (label: string, same: string, entry: Found, collides: boolean) => {
    if (entry.schema === "pg_catalog") problems.push(`${label} ${entry.name} im Systemschema pg_catalog`);
    else if (collides) problems.push(`${label} ${entry.name} überdeckt ${same}`);
    else hints.push(`${label} ${entry.name}`);
  };
  for (const fn of objects.functions) {
    if (own.has(fn.name) || shipped(members.functions, fn)) continue;
    judge("Zusätzliche Funktion", "eine gleichnamige Funktion", fn, fn.builtin || ownNames.has(fn.proname));
  }
  for (const operator of objects.operators) {
    if (!shipped(members.operators, operator)) judge("Zusätzlicher Operator", "einen gleichnamigen Operator", operator, operator.builtin);
  }
  for (const cast of objects.casts) if (!shipped(members.casts, cast)) problems.push(`Zusätzlicher Cast ${cast.name}`);
  for (const relation of objects.relations) {
    if (relation.schema === "pg_catalog") problems.push(`Zusätzliche Relation ${relation.name} im Systemschema pg_catalog`);
    else problems.push(`Relation ${relation.name} überdeckt eine gleichnamige Tabelle`);
  }
  // Vor public liest PostgreSQL pg_catalog und, wenn es existiert, das Schema mit dem Namen der Anmeldung ("$user"). Das
  // temporäre Schema der Sitzung überspringt es für Funktionen und Operatoren, erkannt an seiner OID, nicht am Namen.
  // https://www.postgresql.org/docs/18/ddl-schemas.html#DDL-SCHEMAS-PATH
  const path = expected.schemas.filter((schema) => schema !== expected.temp);
  for (const schema of path) if (schema !== "pg_catalog" && schema !== "public") problems.push(`Schema ${schema} im Suchpfad der Verbindung`);
  if (path[0] !== "pg_catalog") problems.push("pg_catalog steht im Suchpfad der Verbindung nicht vorn");
  return { problems, hints };
}

/** Eingebaute Funktionen in pg_catalog, die nicht in C fest eingebaut sind, mit einem Hash über ihre Definition */
export type Builtins = { major: number; functions: Entry[] };

/*
 * Ein Superuser kann eine eingebaute Funktion an Ort und Stelle ersetzen (CREATE OR REPLACE in pg_catalog); ihre OID
 * bleibt dabei unter FirstNormalObjectId. Fest eingebaute Funktionen (Sprache internal) unterscheiden sich zwischen
 * Unterversionen (18.7 hat eine mehr als 18.6). Die übrigen, in SQL oder als C-Bibliothek, waren in 18.4, 18.6 und 18.7
 * gleich. Eine ersetzte Funktion fällt deshalb so auf: Eigener Code in SQL oder PL/pgSQL macht aus einer fest eingebauten
 * eine zusätzliche Funktion dieser Gruppe, an einer Funktion der Gruppe ändert er den Hash. Eine fest eingebaute Funktion
 * ruft PostgreSQL über ihre OID aus der eingebauten Tabelle auf, ohne pg_proc zu lesen; eine Umleitung auf eine andere fest
 * eingebaute oder geänderte Eigenschaften wirken deshalb nicht.
 * https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/fmgr/fmgr.c (fmgr_isbuiltin)
 * Erwartet search_path = pg_catalog wie die übrigen Abfragen des Sollbestands.
 */
export async function readBuiltinFunctions(tx: Connection): Promise<Builtins> {
  const [version] = await tx.execute<{ major: number }>(sql`select current_setting('server_version_num')::integer / 10000 as major`);
  const rows = await tx.execute<{ name: string }>(sql`
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as name, ${functionDefinition}
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid < 16384 and n.nspname = 'pg_catalog' and l.lanname <> 'internal'`);
  const functions = withHash([...rows], ["name"]).map(({ name, hash }) => ({ name, hash }));
  return { major: Number(version!.major), functions: functions.sort(byName) };
}

/** Befunde zu eingebauten Funktionen; auf einer anderen Hauptversion als der des Sollbestands nur ein Hinweis */
export function builtinFindings(expected: Builtins, actual: Builtins): { problems: string[]; hints: string[] } {
  if (actual.major !== expected.major) {
    return {
      problems: [],
      hints: [`Eingebaute Funktionen nicht geprüft: Der Sollbestand gilt für PostgreSQL ${expected.major}, der Server hat ${actual.major}`],
    };
  }
  const found = new Map(actual.functions.map((fn) => [fn.name, fn.hash]));
  const known = new Set(expected.functions.map((fn) => fn.name));
  const problems: string[] = [];
  for (const fn of expected.functions) {
    const hash = found.get(fn.name);
    if (hash === undefined) problems.push(`Eingebaute Funktion ${fn.name} fehlt oder wurde verändert`);
    else if (hash !== fn.hash) problems.push(`Eingebaute Funktion ${fn.name} wurde verändert`);
  }
  for (const fn of actual.functions) if (!known.has(fn.name)) problems.push(`Eingebaute Funktion ${fn.name} durch eigenen Code ersetzt`);
  return { problems, hints: [] };
}
