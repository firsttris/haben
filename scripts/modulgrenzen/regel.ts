import { basename, dirname, resolve, sep } from "node:path";
import { parseSync, Visitor } from "oxc-parser";

/*
 * Modulgrenzen im Server (#81, Schritt 6). Fachlicher Code liegt in apps/web/src/server/modules/<name>/; was ein Modul
 * nach außen anbietet, steht in seiner index.ts. Die Regel prüft jeden relativen Import:
 *
 * - Aus einem anderen Modul nur über dessen index.ts, nie direkt in eine Datei dahinter.
 * - Gemeinsame Infrastruktur (server/*.ts, server/db/) importiert gar kein Modul, sonst hängt sie an der Fachlogik.
 *   Ausgenommen sind die Stellen, die Module zusammensetzen: functions/, plugins/ und scheduler.ts.
 * - Module importieren weder Server Functions noch Oberfläche (routes/, components/); src/lib/ ist erlaubt. Die
 *   Abhängigkeit läuft nur von außen nach innen.
 *
 * Biome kann das nicht selbst: seine Regeln vergleichen nur den Text des Imports, hier zählt der aufgelöste Pfad.
 * Tests sind ausgenommen (siehe pruefen.ts), sie dürfen in Dateien anderer Module greifen.
 */

export interface Verstoss {
  /** Zeichenposition des Importpfads in der Datei */
  start: number;
  message: string;
}

const MODULES = `${sep}src${sep}server${sep}modules${sep}`;
const SERVER = `${sep}src${sep}server${sep}`;
const COMPOSITION = [`${SERVER}functions${sep}`, `${SERVER}plugins${sep}`];
const OUTSIDE = [`${SERVER}functions${sep}`, `${SERVER}plugins${sep}`, `${sep}src${sep}routes${sep}`, `${sep}src${sep}components${sep}`];

/**
 * Modulname und Pfad unterhalb des Moduls, oder null außerhalb von modules/. Der Modulordner selbst und `index` ohne
 * Endung lösen wie `index.ts` auf.
 */
function moduleOf(file: string): { name: string; inner: string } | null {
  const at = file.lastIndexOf(MODULES);
  if (at < 0) return null;
  const [name, ...rest] = file
    .slice(at + MODULES.length)
    .split(sep)
    .filter(Boolean);
  if (!name) return null;
  const inner = rest.join("/");
  return { name, inner: inner === "" || inner === "index" ? "index.ts" : inner };
}

function isInfrastructure(file: string): boolean {
  const at = file.lastIndexOf(SERVER);
  if (at < 0 || moduleOf(file)) return false;
  if (COMPOSITION.some((dir) => file.includes(dir))) return false;
  return basename(file) !== "scheduler.ts";
}

/** Die Meldung für einen Import aus `file`, oder null, wenn er erlaubt ist */
export function checkImport(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const own = moduleOf(file);
  const path = resolve(dirname(file), specifier);
  if (own && OUTSIDE.some((dir) => path.includes(dir))) {
    return `Ein Modul importiert keine Server Functions und keine Oberfläche („${specifier}“). Gemeinsames gehört in das Modul oder in src/lib/.`;
  }
  const target = moduleOf(path);
  if (!target || target.name === own?.name) return null;
  if (isInfrastructure(file)) {
    return `Gemeinsame Infrastruktur darf kein Modul importieren („${target.name}“). Gehört der Code ins Modul, verschiebe ihn dorthin.`;
  }
  if (target.inner !== "index.ts") {
    return `Modul „${target.name}“ nur über seine index.ts importieren, nicht „${target.inner}“. Fehlt der Name dort, ergänze ihn in modules/${target.name}/index.ts.`;
  }
  return null;
}

/** Alle Importpfade einer Datei: import, export … from, import() und Typen wie import("…").T */
export function importsOf(file: string, code: string): { start: number; specifier: string }[] {
  const found: { start: number; specifier: string }[] = [];
  const add = (source: unknown) => {
    const literal = source as { type?: string; value?: unknown; start: number } | null | undefined;
    if (literal?.type === "Literal" && typeof literal.value === "string") found.push({ start: literal.start, specifier: literal.value });
  };
  new Visitor({
    ImportDeclaration: (node) => add(node.source),
    ExportNamedDeclaration: (node) => add(node.source),
    ExportAllDeclaration: (node) => add(node.source),
    ImportExpression: (node) => add(node.source),
    TSImportType: (node) => add(node.source),
  }).visit(parseSync(file, code).program);
  return found;
}

/** Verstöße einer Datei mit diesem Inhalt; `file` ist ein absoluter Pfad */
export function checkFile(file: string, code: string): Verstoss[] {
  const absolute = resolve(file);
  return importsOf(absolute, code).flatMap(({ start, specifier }) => {
    const message = checkImport(absolute, specifier);
    return message ? [{ start, message }] : [];
  });
}
