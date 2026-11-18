/*
 * Abstände liegen auf dem 4px-Raster (DESIGN.md, Grundlagen). Geprüft werden `padding*`, `margin*`, `gap`, `row-gap`
 * und `column-gap` in CSS: jede px-Zahl im Wert muss durch 4 teilbar sein, auch negativ oder in `calc()`. Ältere
 * Stellen daneben stehen in altstellen.json, je Datei die Deklaration mit ihrer Anzahl; geräumt werden sie nur, wenn
 * ein Pull Request die Stelle ohnehin anfasst, ohne Umstellung auf Variablen (#1388: viel Änderung ohne sichtbaren
 * Gewinn). Ein Fehler ist eine Deklaration, die in ihrer Datei öfter vorkommt als erlaubt.
 */

export const GRID = 4;

export type Finding = { line: number; declaration: string };
/** Datei → Deklaration → Anzahl */
export type Allowed = Record<string, Record<string, number>>;
export type Report = { file: string; message: string };

const PROPERTY = /(?<=^|[{;\s])((?:padding|margin)(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:\s*([^;{}]+)/g;
const PX = /(-?\d*\.?\d+)px\b/g;

/** Kommentare durch Leerzeichen ersetzen, Zeilenumbrüche bleiben für die Zeilennummer */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

const offGrid = (value: string) => [...value.matchAll(PX)].some(([, number]) => Math.abs(Number(number)) % GRID !== 0);

/** Deklarationen mit px-Werten neben dem Raster, mit Zeile; Wert mit zusammengefassten Leerzeichen */
export function offGridDeclarations(css: string): Finding[] {
  const code = stripComments(css);
  return [...code.matchAll(PROPERTY)]
    .filter(([, , value]) => offGrid(value))
    .map((match) => ({
      line: code.slice(0, match.index).split("\n").length,
      declaration: `${match[1]}: ${match[2].trim().replace(/\s+/g, " ")}`,
    }));
}

function count(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { declaration } of findings) counts[declaration] = (counts[declaration] ?? 0) + 1;
  return counts;
}

/** Fehler: Deklarationen, die in einer Datei öfter vorkommen, als altstellen.json erlaubt */
export function newOffGrid(found: Record<string, Finding[]>, allowed: Allowed): Report[] {
  return Object.entries(found).flatMap(([file, findings]) => {
    const counts = count(findings);
    return findings
      .filter(({ declaration }) => counts[declaration] > (allowed[file]?.[declaration] ?? 0))
      .map(({ line, declaration }) => ({
        file: `${file}:${line}`,
        message: `\`${declaration}\` liegt neben dem 4px-Raster (${counts[declaration]}× in der Datei, erlaubt ${allowed[file]?.[declaration] ?? 0}): Wert durch 4 teilbar wählen.`,
      }));
  });
}

/** Hinweis: Einträge in altstellen.json, die seltener oder nicht mehr vorkommen */
export function removableEntries(found: Record<string, Finding[]>, allowed: Allowed): Report[] {
  return Object.entries(allowed).flatMap(([file, declarations]) => {
    const counts = count(found[file] ?? []);
    return Object.entries(declarations)
      .filter(([declaration, allowedCount]) => (counts[declaration] ?? 0) < allowedCount)
      .map(([declaration, allowedCount]) => ({
        file,
        message: `\`${declaration}\` noch ${counts[declaration] ?? 0}× statt ${allowedCount}×: kann mit \`bun scripts/raster/pruefen.ts --aufraeumen\` aus altstellen.json.`,
      }));
  });
}

const sortedKeys = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) as Record<string, T>;

/** Liste nach --erfassen (alles, was es gibt) oder --aufraeumen (höchstens die bisherige Anzahl), sortiert */
export function allowedList(found: Record<string, Finding[]>, previous?: Allowed): Allowed {
  const entries = Object.entries(found).flatMap(([file, findings]) => {
    const counts = Object.entries(count(findings))
      .map(([declaration, n]) => [declaration, previous ? Math.min(n, previous[file]?.[declaration] ?? 0) : n] as const)
      .filter(([, n]) => n > 0);
    return counts.length > 0 ? [[file, sortedKeys(Object.fromEntries(counts))] as const] : [];
  });
  return sortedKeys(Object.fromEntries(entries));
}
