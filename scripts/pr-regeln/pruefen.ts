import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { countLines, grownOldFiles } from "../dateigroesse/regel.ts";
import { checkTitle, growthHints, hints, type Report } from "./regel.ts";

/*
 * Prüft einen Pull Request nach regel.ts. Läuft in .github/workflows/pr-regeln.yml mit dem Ereignis aus
 * GITHUB_EVENT_PATH und der ganzen Historie (fetch-depth: 0), damit Basis und Kopf des Pull Requests da sind.
 */

type PullRequest = { title: string; base: { sha: string }; head: { sha: string } };

const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
  pull_request: PullRequest;
};

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const range = `${pr.base.sha}...${pr.head.sha}`;

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
const grown = grownOldFiles(linesAt(pr.base.sha), linesAt(pr.head.sha), oldFiles);

const reports: Report[] = [...checkTitle(pr.title), ...hints(files, subjects), ...growthHints(grown)];

// Annotationen von GitHub Actions: erscheinen an der Prüfung und in der Zusammenfassung des Laufs
for (const { level, message } of reports) console.log(`::${level} title=PR-Regeln::${message}`);
if (reports.length === 0) console.log("PR-Regeln: alles in Ordnung");
if (reports.some(({ level }) => level === "error")) process.exit(1);
