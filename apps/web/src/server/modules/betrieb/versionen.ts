import { desc, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

export interface AppVersionEntry {
  id: number;
  version: string;
  postgresVersion: string;
  startedAt: string;
  note: string | null;
}

function toIsoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * Alle eingesetzten Haben- und PostgreSQL-Versionen in absteigender Reihenfolge für Einstellungen › Export.
 */
export async function listAppVersions(): Promise<AppVersionEntry[]> {
  const rows = await db
    .select({
      id: schema.appVersions.id,
      version: schema.appVersions.version,
      postgresVersion: schema.appVersions.postgresVersion,
      startedAt: schema.appVersions.startedAt,
      note: schema.appVersions.note,
    })
    .from(schema.appVersions)
    .orderBy(desc(schema.appVersions.id));

  return rows.map((row) => ({
    ...row,
    startedAt: toIsoTimestamp(row.startedAt),
  }));
}

/**
 * Versionen, die während des Geschäftsjahres `year` (Europe/Berlin) aktiv waren — einschließlich einer zuvor
 * gestarteten Version, die ins Jahr hineinlief — in chronologischer Reihenfolge für das Jahresarchiv.
 */
export async function appVersionsForYear(year: number): Promise<AppVersionEntry[]> {
  const yearStart = sql`(${`${year}-01-01 00:00:00`}::timestamp at time zone 'Europe/Berlin')`;
  const yearEnd = sql`(${`${year + 1}-01-01 00:00:00`}::timestamp at time zone 'Europe/Berlin')`;

  const result = await db.execute<{
    id: number;
    version: string;
    postgresVersion: string;
    startedAt: Date | string;
    note: string | null;
  }>(sql`
    with timeline as (
      select
        id,
        version,
        postgres_version as "postgresVersion",
        started_at as "startedAt",
        note,
        lead(started_at) over (order by id asc) as next_started_at
      from app_versions
    )
    select id, version, "postgresVersion", "startedAt", note
    from timeline
    where "startedAt" < ${yearEnd}
      and (next_started_at is null or next_started_at > ${yearStart})
    order by id asc
  `);

  const rows = Array.from(result);
  return rows.map((row) => ({
    id: Number(row.id),
    version: row.version,
    postgresVersion: row.postgresVersion,
    startedAt: toIsoTimestamp(row.startedAt),
    note: row.note ?? null,
  }));
}
