import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Allowed, allowedList, newOffGrid, offGridDeclarations, removableEntries } from "./regel.ts";

/*
 * Prüft Abstände in apps/web/src/**\/*.css auf das 4px-Raster (regel.ts). Läuft mit `bun run lint`: Fehler für neue
 * Stellen, die nicht in altstellen.json stehen, Hinweise ohne Abbruch.
 * `--aufraeumen` nimmt geräumte Stellen aus altstellen.json; `--erfassen` nimmt alle heutigen auf (nur bei der Einführung).
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const listFile = fileURLToPath(new URL("altstellen.json", import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

const found = Object.fromEntries(cssFiles(join(root, "apps/web/src")).map((file) => [relative(root, file), offGridDeclarations(readFileSync(file, "utf8"))]));
const allowed: Allowed = JSON.parse(readFileSync(listFile, "utf8"));

const write = (list: Allowed) => writeFileSync(listFile, `${JSON.stringify(list, null, 2)}\n`);

if (process.argv.includes("--erfassen")) {
  write(allowedList(found));
} else if (process.argv.includes("--aufraeumen")) {
  write(allowedList(found, allowed));
} else {
  for (const { file, message } of removableEntries(found, allowed)) console.log(`Hinweis: ${file}  ${message}`);
  const errors = newOffGrid(found, allowed);
  for (const { file, message } of errors) console.error(`${file}  ${message}`);
  if (errors.length > 0) {
    console.error(`\nRaster: ${errors.length} Abst${errors.length === 1 ? "and" : "ände"} neben dem 4px-Raster, nicht in altstellen.json`);
    process.exit(1);
  }
}
