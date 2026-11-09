import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { countLines, largeFiles, newLargeFiles, removableOldFiles } from "./regel.ts";

/*
 * Prüft die Länge der Quelldateien (regel.ts) in apps/*\/src, packages/*\/src und scripts, ohne Tests und
 * erzeugte Dateien. Läuft mit `bun run lint`: Fehler nur für neue Dateien über 400 Zeilen, Hinweise ohne Abbruch.
 * `--aufraeumen` nimmt geschrumpfte und gelöschte Dateien aus altdateien.json; `--erfassen` nimmt alle heutigen
 * großen Dateien auf (nur bei der Einführung).
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const listFile = fileURLToPath(new URL("altdateien.json", import.meta.url));

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
const oldFiles: string[] = JSON.parse(readFileSync(listFile, "utf8"));

const write = (files: string[]) => writeFileSync(listFile, `${JSON.stringify(files, null, 2)}\n`);

if (process.argv.includes("--erfassen")) {
  write(largeFiles(lines, Object.keys(lines)));
} else if (process.argv.includes("--aufraeumen")) {
  write(largeFiles(lines, oldFiles));
} else {
  for (const { file, message } of removableOldFiles(lines, oldFiles)) console.log(`Hinweis: ${file}  ${message}`);
  const errors = newLargeFiles(lines, oldFiles);
  for (const { file, message } of errors) console.error(`${file}  ${message}`);
  if (errors.length > 0) {
    console.error(`\nDateigröße: ${errors.length} neue Datei${errors.length === 1 ? "" : "en"} über 400 Zeilen`);
    process.exit(1);
  }
}
