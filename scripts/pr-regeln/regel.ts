import { schliessendeStichwoerter } from "../board/regel.ts";

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

/**
 * Issues verweist die Beschreibung mit `Refs #…` (Teil) oder `Umgesetzt #…` (fertig). `Closes` und `Fixes`
 * schlössen das Issue schon beim Merge; geschlossen wird aber erst beim Release (scripts/board).
 */
export function checkBody(body: string | null): Report[] {
  return schliessendeStichwoerter(body ?? "").map((treffer) => ({
    level: "error",
    message: `Beschreibung: „${treffer}“ schlösse das Issue schon beim Merge. Mit „Umgesetzt #…“ (fertig) oder „Refs #…“ (Teil) schließt es das Release.`,
  }));
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
 * Nur Markdown, docs/, mkdocs.yml oder LICENSE: die Grenze des Jobs `changes` in ci.yml (ohne dessen Sonderfall für
 * Gelöschtes) und dazu mkdocs.yml, das nach tdd-review, Schritt 0, ebenfalls zu doku-pruefen gehört
 */
const isDocsOnly = (files: string[]) => files.length > 0 && files.every((file) => /\.md$|^docs\/|^mkdocs\.yml$|^LICENSE$/.test(file));
/** Wer Haben pflegt, prüft und mergt selbst; author_association aus dem Ereignis von GitHub */
const MAINTAINERS = ["OWNER", "MEMBER", "COLLABORATOR"];

/**
 * Erinnerung an Selbstprüfung und unabhängiges Review (docs/entwicklung.md, Beiträge annehmen) für fremde Pull
 * Requests außerhalb des Entwurfs. Fest, ohne Blick auf die Kommentare: pr-regeln.yml läuft nicht bei neuen
 * Kommentaren, ein Hinweis, der von einem Kommentar abhängt, bliebe bis zum nächsten Push stehen (#737).
 */
export function reviewHint(pr: { draft?: boolean; author_association?: string; user: { login: string; type?: string } }, files: string[]): Report[] {
  if (pr.draft || isBot(pr.user) || MAINTAINERS.includes(pr.author_association ?? "")) return [];
  const review = isDocsOnly(files) ? "`doku-pruefen` (nur Doku geändert)" : "`tdd-review`";
  return [
    {
      level: "warning",
      message: `Vor dem Merge: Selbstprüfung mit \`beitrag-pruefen\` als Kommentar im Pull Request, dann ein unabhängiges Review mit ${review} durch jemand anderen oder einen frischen Agenten. Die Skills liegen in .claude/skills/; ohne beides prüfen wir alles selbst nach, und der Merge dauert (docs/entwicklung.md, Beiträge annehmen).`,
    },
  ];
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
