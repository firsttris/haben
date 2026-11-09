/*
 * Regeln für Pull Requests aus CLAUDE.md und docs/entwicklung.md (Mitwirken), die sich am Pull Request selbst
 * prüfen lassen. Fehler halten den Pull Request auf, Hinweise erscheinen nur als Warnung an der Prüfung.
 */

export type Report = { level: "error" | "warning"; message: string };

const CONVENTIONAL = /^(feat|fix|docs|test|refactor|chore|style|perf|build|ci|revert)(\(.*\))?!?:/;
/** Bereich: ein bis drei Wörter, groß geschrieben („Belege“, „E-Rechnung“, „Doku-Bilder“, „ELSTER“) */
const TITLE = /^\p{Lu}[\p{L}\d-]*(?: [\p{L}\d-]+){0,2}: \S.*$/u;

/** Titel nach `Bereich: was sich ändert (#Issue)`; der Squash-Merge macht ihn zum Commit auf main */
export function checkTitle(title: string): Report[] {
  const trimmed = title.trim();
  if (CONVENTIONAL.test(trimmed)) {
    return [
      {
        level: "error",
        message: `Titel „${trimmed}“: Conventional Commits gelten für Commits im Pull Request, der Titel heißt „Bereich: was sich ändert (#Issue)“, etwa „Belege: Splitbuchung mit zwei Steuersätzen (#123)“.`,
      },
    ];
  }
  if (!TITLE.test(trimmed)) {
    return [
      {
        level: "error",
        message: `Titel „${trimmed}“ folgt nicht „Bereich: was sich ändert (#Issue)“, etwa „Belege: Splitbuchung mit zwei Steuersätzen (#123)“.`,
      },
    ];
  }
  if (trimmed.endsWith(".")) return [{ level: "error", message: `Titel „${trimmed}“ endet ohne Punkt.` }];
  return [];
}

/** Werkzeuge und Modelle, deren Co-Authored-By einen Commit als von einem Agenten geschrieben kennzeichnet */
const AGENT = /^co-authored-by:.*\b(claude|anthropic|copilot|codex|openai|chatgpt|gemini|cursor|devin|aider|jules)\b/im;

export function isAgentCommit(message: string): boolean {
  return AGENT.test(message);
}

/** Hat ein Agent Commits geschrieben, nennt die Beschreibung das Werkzeug („🤖 Generated with …“) */
export function checkAgentMarker(body: string, commitMessages: string[]): Report[] {
  if (!commitMessages.some(isAgentCommit) || /generated with/i.test(body)) return [];
  return [
    {
      level: "error",
      message: "Commits mit Co-Authored-By eines Agenten, aber die Beschreibung hat keine Zeile „🤖 Generated with <Werkzeug>“ (CLAUDE.md, Pull requests).",
    },
  ];
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
