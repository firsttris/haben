/*
 * Regeln für Pull Requests aus CLAUDE.md und docs/entwicklung.md (Mitwirken), die sich am Pull Request selbst
 * prüfen lassen. Fehler halten den Pull Request auf, Hinweise erscheinen nur als Warnung an der Prüfung.
 */

export type Report = { level: "error" | "warning"; message: string };

const CONVENTIONAL = /^(feat|fix|docs|test|refactor|chore|style|perf|build|ci|revert)(\(.*\))?!?:/;
/**
 * Bereich: ein bis drei Wörter („Belege“, „E-Rechnung“, „Doku-Bilder“, „ELSTER“); klein nur, wenn ein Name so
 * geschrieben wird („sevDesk“, Review von #463). Die Issue-Nummer ist freiwillig, nicht jeder Pull Request hat eins.
 */
const TITLE = /^\p{L}[\p{L}\d-]*(?: [\p{L}\d-]+){0,2}: \S.*$/u;

/** Titel nach `Bereich: was sich ändert (#Issue)`; der Squash-Merge macht ihn zum Commit auf main */
export function checkTitle(title: string): Report[] {
  const trimmed = title.trim();
  if (CONVENTIONAL.test(trimmed)) {
    return [
      {
        level: "error",
        message: `Titel „${trimmed}“: Conventional Commits gelten für Commits im Pull Request, der Titel heißt „Bereich: was sich ändert“, mit „(#Issue)“, falls es eins gibt, etwa „Belege: Splitbuchung mit zwei Steuersätzen (#123)“.`,
      },
    ];
  }
  if (!TITLE.test(trimmed)) {
    return [
      {
        level: "error",
        message: `Titel „${trimmed}“ folgt nicht „Bereich: was sich ändert“ (mit „(#Issue)“, falls es eins gibt), etwa „Belege: Splitbuchung mit zwei Steuersätzen (#123)“.`,
      },
    ];
  }
  if (trimmed.endsWith(".")) return [{ level: "error", message: `Titel „${trimmed}“ endet ohne Punkt.` }];
  return [];
}

const isTest = (file: string) => /\.(test|spec)\.tsx?$/.test(file) || file.includes("/e2e/");
const isCode = (file: string) => /^(apps\/web\/src|packages\/[^/]+\/src)\/.*\.tsx?$/.test(file) && !isTest(file) && !file.endsWith("routeTree.gen.ts");
const isFix = (subject: string) => /^fix(\(.*\))?!?:/.test(subject);

/**
 * Hinweise auf Regeln, die sich nicht sicher entscheiden lassen: Code ohne Doku, Fix ohne Test. Ein Refactor
 * braucht keine Doku, ein Fix an der CI keinen Test; deshalb nur Warnungen.
 */
export function hints(files: string[], commitSubjects: string[]): Report[] {
  const reports: Report[] = [];
  if (files.some(isCode) && !files.some((file) => file.startsWith("docs/"))) {
    reports.push({
      level: "warning",
      message: "Code geändert, aber nichts in docs/: Beschreibt eine Doku-Seite das geänderte Verhalten?",
    });
  }
  if (commitSubjects.some(isFix) && !files.some(isTest)) {
    reports.push({
      level: "warning",
      message: "fix-Commit ohne geänderten Test: Ein Bugfix beginnt mit einem Test, der fehlschlägt (CLAUDE.md).",
    });
  }
  return reports;
}

/**
 * Wachstum, ab dem ein Hinweis kommt: Kleinere Änderungen an alten Dateien sind die Regel (im Review von #463 hätte
 * der Hinweis ohne Schwelle bei 50 von 100 Pull Requests angeschlagen) und würden ihn überhören lassen.
 */
export const GROWTH_THRESHOLD = 20;
/** Dateien, die wachsen müssen: Jede neue Tabelle oder Spalte gehört nach schema.ts (docs/entwicklung.md, Migrationen) */
export const MAY_GROW = ["apps/web/src/server/db/schema.ts"];

/** Hinweis auf alte große Dateien, die im Pull Request deutlich gewachsen sind (scripts/dateigroesse) */
export function growthHints(grown: { file: string; before: number; after: number }[]): Report[] {
  return grown
    .filter(({ file, before, after }) => after - before >= GROWTH_THRESHOLD && !MAY_GROW.includes(file))
    .map(({ file, before, after }) => ({
      level: "warning",
      message: `${file} wächst von ${before} auf ${after} Zeilen: Lässt sich das Neue in eine eigene Datei legen?`,
    }));
}

/**
 * Pull Requests von Bots (Renovate) tragen deren eigene Titel wie „Lock file maintenance“. Sie bekommen keine
 * Titelprüfung, sonst würde der rote Check den Automerge von Renovate stoppen (Review von #463).
 */
export function isBot(user: { login: string; type?: string }): boolean {
  return user.type === "Bot" || user.login.endsWith("[bot]");
}
