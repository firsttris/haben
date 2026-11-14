import { releaseNotesUrl } from "../../../lib/release-notes.ts";
import { appVersionsForYear } from "../betrieb/index.ts";

export const VERSIONEN_HEADER = ["Version", "Seit", "PostgreSQL", "Hinweis", "Versionshinweise"];

/**
 * Zeilen für `protokoll/versionen.csv` eines Archivjahrs in chronologischer Reihenfolge.
 * Enthält auch eine bereits vor Jahresbeginn gestartete Version, solange sie ins Jahr hineinlief.
 */
export async function versionenFuerArchiv(year: number): Promise<(string | null)[][]> {
  const entries = await appVersionsForYear(year);
  return entries.map((entry) => [entry.version, entry.startedAt, entry.postgresVersion, entry.note ?? "", releaseNotesUrl(entry.version)]);
}
