import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile } from "./regel.ts";

/*
 * Prüft die Modulgrenzen (regel.ts) für alle Quelldateien in apps/web/src und in src/ jedes Pakets, außer Tests. Läuft mit
 * `bun run lint`.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const src = join(root, "apps/web/src");

const isSource = (name: string) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && name !== "routeTree.gen.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return isSource(entry.name) ? [path] : [];
  });
}

function lineOf(code: string, start: number): number {
  return code.slice(0, start).split("\n").length;
}

const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, "packages", entry.name, "src"));

const reports = [src, ...packages].flatMap(sourceFiles).flatMap((file) => {
  const code = readFileSync(file, "utf8");
  return checkFile(file, code).map(({ start, message }) => `${relative(root, file)}:${lineOf(code, start)}  ${message}`);
});

for (const report of reports) console.error(report);
if (reports.length > 0) {
  console.error(`\nModulgrenzen: ${reports.length} Verstoß${reports.length === 1 ? "" : "e"}`);
  process.exit(1);
}
