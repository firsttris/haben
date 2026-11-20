/** Verweist auf die Versionshinweise (Release Notes) eines veröffentlichten Stands auf GitHub. */
export function releaseNotesUrl(version: string): string {
  return `https://github.com/Speicherstadt/haben/releases/tag/v${encodeURIComponent(version)}`;
}

/** Zerlegt `X.Y.Z` oder `X.Y.Z-rc.N` (mit oder ohne führendes „v“); alles andere ist keine Version. */
function parseVersion(version: string): { parts: [number, number, number]; rc: number | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version.trim());
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], rc: match[4] === undefined ? null : Number(match[4]) };
}

/**
 * Ob `latest` neuer ist als `installed`. Ein Release Candidate gilt als älter als die Version gleicher Nummer;
 * ist eine der beiden keine Version (etwa ein Entwicklungsstand), gibt es keinen Hinweis.
 */
export function isNewerVersion(latest: string, installed: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i]! > b.parts[i]!;
  if (a.rc === b.rc) return false;
  if (a.rc === null) return true;
  if (b.rc === null) return false;
  return a.rc > b.rc;
}
