/** Verweist auf die Versionshinweise (Release Notes) eines veröffentlichten Stands auf GitHub. */
export function releaseNotesUrl(version: string): string {
  return `https://github.com/firsttris/haben/releases/tag/v${encodeURIComponent(version)}`;
}
