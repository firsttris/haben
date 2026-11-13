import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { countLines, grownOldFiles } from "../dateigroesse/regel.ts";
import { checkBody, checkTitle, countWords, docPageHints, growthHints, hints, isBot, type Report, reviewHint } from "./regel.ts";

/*
 * Prüft einen Pull Request nach regel.ts. Läuft in .github/workflows/pr-regeln.yml mit dem Ereignis aus
 * GITHUB_EVENT_PATH und der ganzen Historie (fetch-depth: 0), damit Basis und Kopf des Pull Requests da sind.
 * Verglichen wird mit der Merge-Base, nicht mit dem Stand der Basis: Liegt der Branch hinter main, zählen sonst
 * Commits und Zeilen von main mit (Review von #463).
 *
 * Ohne GITHUB_EVENT_PATH prüft es den Branch vor dem Push (Skill `beitrag`, Schritt 4): HEAD gegen --basis
 * (Standard origin/main, ohne fetch, damit es schnell bleibt), Titel und Beschreibung aus den Argumenten.
 * Ohne --titel bleiben Titel und Beschreibung ungeprüft. Den Hinweis auf Selbstprüfung und Review gibt es
 * lokal nicht, er gilt erst für „Ready for review“.
 */

type PullRequest = {
  number: number;
  title: string | null;
  draft?: boolean;
  author_association?: string;
  body: string | null;
  user: { login: string; type?: string };
  base: { sha: string };
  head: { sha: string };
};

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function lokalerPullRequest(): PullRequest {
  const { values } = parseArgs({
    options: { titel: { type: "string" }, beschreibung: { type: "string" }, basis: { type: "string", default: "origin/main" } },
  });
  return {
    number: 0,
    title: values.titel ?? null,
    draft: true,
    body: values.beschreibung ? readFileSync(values.beschreibung, "utf8") : null,
    user: { login: "lokal" },
    base: { sha: git("rev-parse", values.basis).trim() },
    head: { sha: git("rev-parse", "HEAD").trim() },
  };
}

const lokal = !process.env.GITHUB_EVENT_PATH;
const pr: PullRequest = lokal
  ? lokalerPullRequest()
  : (JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as { pull_request: PullRequest }).pull_request;

const mergeBase = git("merge-base", pr.base.sha, pr.head.sha).trim();
const range = `${mergeBase}..${pr.head.sha}`;

const subjects = git("log", "--format=%s", range).split("\n").filter(Boolean);
const files = git("diff", "--name-only", range).split("\n").filter(Boolean);

// Zeilen der geänderten alten Dateien vorher und nachher, für den Hinweis auf gewachsene große Dateien
const oldFiles: string[] = JSON.parse(readFileSync("scripts/dateigroesse/altdateien.json", "utf8"));
const linesAt = (sha: string) =>
  Object.fromEntries(
    files
      .filter((file) => oldFiles.includes(file))
      .flatMap((file) => {
        try {
          return [[file, countLines(git("show", `${sha}:${file}`))]];
        } catch {
          return []; // in diesem Stand gibt es die Datei nicht
        }
      }),
  );
const grown = grownOldFiles(linesAt(mergeBase), linesAt(pr.head.sha), oldFiles);

// Wörter der geänderten Seiten unter docs/ vorher und nachher, für den Hinweis auf zu lange Seiten
const wordsAt = (sha: string, file: string) => {
  try {
    return countWords(git("show", `${sha}:${file}`));
  } catch {
    return 0; // in diesem Stand gibt es die Seite nicht
  }
};
// Eine umbenannte Seite zählt vorher unter ihrem alten Namen, sonst gälte sie als neu (Review von #854)
const renamedFrom: Record<string, string> = Object.fromEntries(
  git("diff", "--name-status", "-M", range, "--", "docs/")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([status]) => status?.startsWith("R"))
    .map(([, from, to]) => [to, from]),
);
const docPages = files
  .filter((file) => file.startsWith("docs/") && file.endsWith(".md"))
  .map((file) => ({ file, before: wordsAt(mergeBase, renamedFrom[file] ?? file), after: wordsAt(pr.head.sha, file) }));

const reports: Report[] = [
  ...(isBot(pr.user) || pr.title === null ? [] : [...checkTitle(pr.title), ...checkBody(pr.body)]),
  ...hints(files, subjects),
  ...growthHints(grown),
  ...docPageHints(docPages),
  ...reviewHint(pr, files),
];

if (lokal) {
  for (const { level, message } of reports) console.log(`${level === "error" ? "Fehler" : "Hinweis"}: ${message}`);
  if (pr.title === null) console.log("Ohne --titel: Titel und Beschreibung nicht geprüft.");
} else {
  // Annotationen von GitHub Actions: erscheinen an der Prüfung und in der Zusammenfassung des Laufs
  for (const { level, message } of reports) console.log(`::${level} title=PR-Regeln::${message}`);
}
if (reports.length === 0) console.log("PR-Regeln: alles in Ordnung");

// Für den Kommentar im Pull Request (kommentar.ts): pr-regeln.yml lädt die Datei als Artefakt hoch
const ausgabe = process.env.PR_REGELN_ERGEBNIS;
if (ausgabe && !lokal) {
  mkdirSync(ausgabe, { recursive: true });
  writeFileSync(`${ausgabe}/ergebnis.json`, JSON.stringify({ pr: pr.number, headSha: pr.head.sha, reports: reports.slice(0, 50) }));
}
if (reports.some(({ level }) => level === "error")) process.exit(1);
