import { Column, type DriverValueDecoder, SQL, type SQLWrapper, is, sql } from "drizzle-orm";
import { db } from "./index.ts";

type Fields = Record<string, unknown>;

/**
 * Ein Teil der gemeinsamen Abfrage eines Moduls für die Schnellsuche (#617): eine eigene Abfrage mit eigener Bedingung,
 * Sortierung und Grenze, damit sie ihren Index behält, und was aus ihren Zeilen die Treffer macht.
 */
export interface SearchPart<Result> {
  fields: Fields;
  query: SQLWrapper;
  finish: (rows: Record<string, unknown>[]) => Result | Promise<Result>;
}

/**
 * Baut einen Teil. `build` bekommt die Felder mit ihrem Schlüssel als Spaltennamen, damit `json_agg` die Zeile unter
 * denselben Namen liefert; `finish` bekommt die Zeilen so, wie die Abfrage allein sie geliefert hätte.
 */
export function searchPart<F extends Fields, Q extends SQLWrapper & PromiseLike<unknown[]>, R>(
  fields: F,
  build: (named: F) => Q,
  finish: (rows: Awaited<Q>) => R | Promise<R>,
): SearchPart<R> {
  const named = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, sql`${field}`.as(key)])) as F;
  return { fields, query: build(named), finish: finish as SearchPart<R>["finish"] };
}

type PartResults<P> = { [K in keyof P]: NonNullable<P[K]> extends SearchPart<infer R> ? R : never };

/** Alle Teile als eine Abfrage: je Teil eine Zeile mit seinen Zeilen als JSON, in der Reihenfolge seiner Sortierung */
export function searchPartsQuery(parts: Partial<Record<string, SearchPart<unknown>>>): SQL {
  return sql.join(
    (Object.entries(parts) as [string, SearchPart<unknown>][]).map(
      ([key, part]) => sql`select ${key}::text as part, coalesce(json_agg(t), '[]'::json) as rows from (${part.query}) t`,
    ),
    sql` union all `,
  );
}

/** Wert aus dem JSON so umwandeln, wie Drizzle ihn aus der Spalte oder dem Ausdruck gelesen hätte (Datum, Zahl) */
function decode(field: unknown, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (is(field, Column)) return field.mapFromDriverValue(value);
  // Wie mapResultRow in Drizzle: `decoder` setzt `mapWith`, ist in den Typen aber nicht öffentlich
  if (is(field, SQL)) return (field as unknown as { decoder: DriverValueDecoder<unknown, unknown> }).decoder.mapFromDriverValue(value);
  return value;
}

/** Führt die Teile eines Moduls in einer Abfrage aus und gibt je Teil das Ergebnis seines `finish` zurück */
export async function runSearchParts<P extends Partial<Record<string, SearchPart<unknown>>>>(parts: P): Promise<PartResults<P>> {
  const keys = Object.keys(parts);
  if (keys.length === 0) return {} as PartResults<P>;
  const rows = (await db.execute(searchPartsQuery(parts))) as unknown as { part: string; rows: unknown }[];
  const results = await Promise.all(
    rows.map(async ({ part: key, rows: json }) => {
      const part = parts[key]!;
      const raw = (typeof json === "string" ? JSON.parse(json) : json) as Record<string, unknown>[];
      const decoded = raw.map((row) => Object.fromEntries(Object.entries(part.fields).map(([name, field]) => [name, decode(field, row[name])])));
      return [key, await part.finish(decoded)] as const;
    }),
  );
  return Object.fromEntries(results) as PartResults<P>;
}

/** Die ersten `limit` Zeilen als Treffer; die Abfrage liest eine mehr, damit „Weitere“ weiß, ob es mehr gibt */
export function firstHits<T>(rows: T[], limit: number): { hits: T[]; more: boolean } {
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}

/** Nur die Teile der gefragten Gruppen */
export function partsFor<B extends Record<string, () => SearchPart<unknown>>>(
  groups: readonly string[],
  builders: B,
): Partial<{ [K in keyof B]: ReturnType<B[K]> }> {
  return Object.fromEntries(
    Object.entries(builders)
      .filter(([group]) => groups.includes(group))
      .map(([group, build]) => [group, build()]),
  ) as Partial<{ [K in keyof B]: ReturnType<B[K]> }>;
}
