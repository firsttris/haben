import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

/** Hinweis in der ersten Zeile auf Bestandsinstanzen (#841). */
export const VERSION_HISTORY_GENESIS_NOTE = "Versionsverlauf ab diesem Start aufgezeichnet; für die Zeit davor liegt keine Aufzeichnung vor.";

const PACKAGE_JSON_PATH = fileURLToPath(new URL("../../../../../package.json", import.meta.url));

/**
 * Liest die Haben-Version aus der Wurzel-`package.json`. Gibt `null` zurück, wenn die Datei in einer
 * isolierten Testumgebung außerhalb des Repositories fehlt.
 */
export function readAppVersion(packageJsonPath = PACKAGE_JSON_PATH): string | null {
  if (!existsSync(packageJsonPath)) return null;
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : null;
}

/**
 * Hält die gestartete Haben- und PostgreSQL-Version fest (GoBD, BMF-Schreiben vom 28.11.2019, Rz. 150 und Rz. 154),
 * sobald die Haben-Version vom zuletzt protokollierten Eintrag abweicht (inklusive Zurückrollen auf ältere Stände).
 */
export async function recordAppVersion(client: postgres.Sql, version = readAppVersion()): Promise<boolean> {
  if (!version) return false;
  return client.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'system:migration', true)`;
    const [last] = await tx<{ version: string }[]>`
      select version from app_versions order by id desc limit 1
    `;
    if (last?.version === version) return false;

    let note: string | null = null;
    if (!last) {
      const [existing] = await tx<{ existing: boolean }[]>`
        select (
          exists(select 1 from audit_log where actor is distinct from 'system:migration')
          or exists(select 1 from "user")
          or exists(select 1 from company)
        ) as existing
      `;
      if (existing?.existing) note = VERSION_HISTORY_GENESIS_NOTE;
    }

    await tx`
      insert into app_versions (version, postgres_version, note)
      values (${version}, current_setting('server_version'), ${note})
    `;
    return true;
  });
}
