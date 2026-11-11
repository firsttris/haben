/*
 * Vorab-Prüfung der Board-Pflege ohne KI (.github/workflows/board-pflege.yml): Gibt es nichts zu tun, startet der
 * Agent nicht und kostet nichts. Arbeit ist ein offenes Issue ohne Karte, auf das weder der Maintainer noch der
 * Bot geantwortet hat, und ein offenes Gespräch: Der letzte Kommentar stammt von jemand anderem.
 */

export const MAINTAINER = "firsttris";
export const BOTS = ["github-actions[bot]", "github-actions", "app/github-actions", "renovate[bot]", "app/renovate"];

export type IssueKurz = { number: number; author: string; labels: string[]; kommentarVon: string[] };

export function arbeit(issues: IssueKurz[], mitKarte: Set<number>): { ohneKarte: number[]; gespraeche: number[] } {
  const wir = (person: string) => person === MAINTAINER || BOTS.includes(person);
  const relevant = issues.filter((issue) => !issue.labels.includes("board-pflege") && !BOTS.includes(issue.author));
  return {
    ohneKarte: relevant.filter((i) => !mitKarte.has(i.number) && !i.kommentarVon.some(wir)).map((i) => i.number),
    gespraeche: relevant.filter((i) => i.kommentarVon.length > 0 && !wir(i.kommentarVon.at(-1) ?? "")).map((i) => i.number),
  };
}
