import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { check, countLines, type Limits, lowered, MAX_LINES } from "./regel.ts";

/*
 * Prüft die Länge der Quelldateien (regel.ts) in apps/*\/src, packages/*\/src und scripts, ohne Tests und
 * erzeugte Dateien. Läuft mit `bun run lint`. `--senken` schreibt kleiner gewordene Grenzen nach grenzen.json;
 * `--erfassen` nimmt den heutigen Stand als Grenzen auf (nur einmal bei der Einführung).
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const limitsFile = fileURLToPath(new URL("grenzen.json", import.meta.url));

const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && name !== "routeTree.gen.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return isSource(entry.name) ? [path] : [];
  });
}

const dirs = [
  ...["apps", "packages"].flatMap((parent) =>
    readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, parent, entry.name, "src")),
  ),
  join(root, "scripts"),
].filter((dir) => existsSync(dir));

const lines = Object.fromEntries(dirs.flatMap(sourceFiles).map((file) => [relative(root, file), countLines(readFileSync(file, "utf8"))]));
const limits: Limits = JSON.parse(readFileSync(limitsFile, "utf8"));

const write = (next: Limits) => writeFileSync(limitsFile, `${JSON.stringify(next, null, 2)}\n`);

if (process.argv.includes("--erfassen")) {
  write(lowered(lines, Object.fromEntries(Object.entries(lines).filter(([, count]) => count > MAX_LINES))));
} else if (process.argv.includes("--senken")) {
  write(lowered(lines, limits));
} else {
  const reports = check(lines, limits);
  for (const { file, message } of reports) console.error(`${file}  ${message}`);
  if (reports.length > 0) {
    console.error(`\nDateigröße: ${reports.length} Meldung${reports.length === 1 ? "" : "en"}`);
    process.exit(1);
  }
}
