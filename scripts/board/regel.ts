/*
 * Regeln für das Project „Roadmap“ (https://github.com/users/firsttris/projects/2) und das Schließen von Issues
 * beim Release, ohne Zugriff auf GitHub. Der Ablauf steht in docs/entwicklung.md unter „Issues in der Beschreibung“:
 * `Refs #…` verweist auf einen Teil, `Umgesetzt #…` heißt fertig. Geschlossen wird erst mit einer fertigen Version.
 */

/** Spalten des Boards in ihrer Reihenfolge; eine Karte rückt nur nach rechts */
export const STATUS = ["Später", "Geplant", "In Arbeit", "Im nächsten Release", "Erledigt"] as const;
export type Status = (typeof STATUS)[number];

/** Code-Blöcke und Inline-Code entfernen: Beispiele wie `Umgesetzt #123` in einer Beschreibung zählen nicht */
export function ohneCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** Nummern hinter einem Stichwort, auch als Liste: „Umgesetzt #12, #13 und #14“ */
function nummernNach(text: string, stichwort: string): number[] {
  const muster = new RegExp(`\\b${stichwort}:?\\s+(#\\d+(?:\\s*(?:,|und|&)\\s*#\\d+)*)`, "giu");
  const nummern = [...text.matchAll(muster)].flatMap((treffer) => [...treffer[1].matchAll(/#(\d+)/g)].map((nummer) => Number(nummer[1])));
  return [...new Set(nummern)];
}

/** Issues, auf die eine PR-Beschreibung oder eine Commit-Nachricht verweist */
export function verweise(text: string): { refs: number[]; umgesetzt: number[] } {
  const sauber = ohneCode(text);
  const umgesetzt = nummernNach(sauber, "Umgesetzt");
  const refs = nummernNach(sauber, "Refs").filter((nummer) => !umgesetzt.includes(nummer));
  return { refs, umgesetzt };
}

/**
 * Stichwörter, mit denen GitHub ein Issue schon beim Merge schließt
 * (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
 * Geschlossen wird bei Haben aber erst beim Release.
 */
export function schliessendeStichwoerter(text: string): string[] {
  const muster = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+)?#\d+/gi;
  return [...ohneCode(text).matchAll(muster)].map((treffer) => treffer[0]);
}

/** Neuer Status einer Karte oder null, wenn sie bleibt: Eine Karte rückt nie zurück */
export function zielStatus(aktuell: string | null, ziel: Status): Status | null {
  const vorher = STATUS.indexOf(aktuell as Status);
  return STATUS.indexOf(ziel) > vorher ? ziel : null;
}

export type Schritt = { issue: number; ziel: Status; hinzufuegen: boolean };

type Ereignis =
  | { art: "issues"; action: string; issue: { number: number; pull_request?: unknown } }
  | { art: "pull_request"; action: string; pull_request: { body: string | null; merged: boolean; state: string } };

/**
 * Was ein Ereignis am Board ändert:
 * - Issue zugewiesen: In Arbeit, nur wenn die Karte schon im Board ist.
 * - PR geöffnet oder geändert: seine Issues (`Refs` und `Umgesetzt`) In Arbeit, nur Karten im Board.
 * - PR gemergt: Issues mit `Umgesetzt` Im nächsten Release; fehlt die Karte, kommt sie dazu, damit das Board
 *   zeigt, was das nächste Release bringt.
 */
export function schritte(ereignis: Ereignis): Schritt[] {
  if (ereignis.art === "issues") {
    if (ereignis.action !== "assigned" || ereignis.issue.pull_request) return [];
    return [{ issue: ereignis.issue.number, ziel: "In Arbeit", hinzufuegen: false }];
  }
  const { action, pull_request: pr } = ereignis;
  const { refs, umgesetzt } = verweise(pr.body ?? "");
  if (action === "closed") {
    if (!pr.merged) return [];
    return umgesetzt.map((issue) => ({ issue, ziel: "Im nächsten Release" as const, hinzufuegen: true }));
  }
  if (!["opened", "reopened", "ready_for_review", "edited"].includes(action) || pr.state !== "open") return [];
  return [...umgesetzt, ...refs].map((issue) => ({ issue, ziel: "In Arbeit" as const, hinzufuegen: false }));
}

const FERTIG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Fertige Version wie v0.7.0; ein Release Candidate (v0.7.0-rc.1) schließt nichts */
export function istFertigeVersion(tag: string): boolean {
  return FERTIG.test(tag);
}

/** Die fertige Version vor `tag`, gegen die gezählt wird; ohne sie gibt es nichts zu schließen */
export function vorigeFertigeVersion(tags: string[], tag: string): string | null {
  const zahl = (t: string) => (FERTIG.exec(t)?.slice(1) ?? []).map(Number);
  const kleiner = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  const aktuell = zahl(tag);
  const vorher = tags.filter((t) => istFertigeVersion(t) && kleiner(zahl(t), aktuell));
  vorher.sort((a, b) => (kleiner(zahl(a), zahl(b)) ? -1 : 1));
  return vorher.at(-1) ?? null;
}

/**
 * Issues, die ein Release schließt, mit den Pull Requests, die sie umgesetzt haben. Die Nachricht eines
 * Squash-Commits auf main ist die PR-Beschreibung, ihre erste Zeile endet mit „(#PR)“.
 */
export function zuSchliessen(commits: string[]): Map<number, number[]> {
  const ergebnis = new Map<number, number[]>();
  for (const nachricht of commits) {
    const pr = /\(#(\d+)\)\s*$/.exec(nachricht.split("\n")[0])?.[1];
    for (const issue of verweise(nachricht).umgesetzt) {
      const prs = ergebnis.get(issue) ?? [];
      if (pr && !prs.includes(Number(pr))) prs.push(Number(pr));
      ergebnis.set(issue, prs);
    }
  }
  return ergebnis;
}

/** Kommentar beim Schließen; wer noch etwas vermisst, öffnet ein neues Issue */
export function kommentar(repo: string, version: string, issue: number, prs: number[]): string {
  const umgesetzt = prs.length > 0 ? ` (umgesetzt in ${prs.map((pr) => `#${pr}`).join(", ")})` : "";
  return [
    `Ist in [${version}](https://github.com/${repo}/releases/tag/${version}) veröffentlicht${umgesetzt}. Damit schließen wir das Issue.`,
    "",
    `Fehlt etwas oder klappt etwas nicht, öffne bitte ein neues Issue und verweise darin auf dieses (#${issue}).`,
  ].join("\n");
}
