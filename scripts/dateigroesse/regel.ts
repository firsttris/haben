/*
 * Eine Datei tut eine Sache: ab etwa 400 Zeilen wird sie geteilt (docs/entwicklung.md, Konventionen). Ältere Dateien
 * sind größer; sie stehen in altdateien.json und dürfen weiter wachsen, denn geteilt werden sie nur in einem eigenen
 * Pull Request. Ein Fehler ist eine Datei über 400 Zeilen, die nicht in der Liste steht: eine neue oder eine bisher
 * kleinere, die über die Grenze wächst; dann kommt das Neue in eine eigene Datei. Wächst eine alte, weist „PR-Regeln“ darauf hin
 * (Review von #463: eine feste Grenze je Datei hätte bei fast jedem zweiten Commit angeschlagen, auch bei schema.ts,
 * wohin jede neue Tabelle gehört).
 */

export const MAX_LINES = 400;

export type Report = { file: string; message: string };

/** Zeilen wie `wc -l`, ein Zeilenumbruch am Ende zählt nicht als eigene Zeile */
export function countLines(code: string): number {
  if (code === "") return 0;
  return code.split("\n").length - (code.endsWith("\n") ? 1 : 0);
}

const isLarge = (count: number) => count > MAX_LINES;

/** Fehler: Dateien über 400 Zeilen, die nicht in der Liste der alten Dateien stehen (neu oder über die Grenze gewachsen) */
export function unlistedLargeFiles(lines: Record<string, number>, oldFiles: string[]): Report[] {
  return Object.entries(lines)
    .filter(([file, count]) => isLarge(count) && !oldFiles.includes(file))
    .map(([file, count]) => ({
      file,
      message: `${count} Zeilen, mehr als ${MAX_LINES} und nicht in altdateien.json: Neues in eine eigene Datei legen. Ist es eine umbenannte alte Datei, den Pfad in altdateien.json mit ändern.`,
    }));
}

/** Hinweis: alte Dateien, die gelöscht oder auf 400 Zeilen geschrumpft sind, können aus der Liste */
export function removableOldFiles(lines: Record<string, number>, oldFiles: string[]): Report[] {
  return oldFiles
    .filter((file) => !isLarge(lines[file] ?? 0))
    .map((file) => ({
      file,
      message: `${file in lines ? `${lines[file]} Zeilen` : "gelöscht"}: kann mit \`bun scripts/dateigroesse/pruefen.ts --aufraeumen\` aus altdateien.json.`,
    }));
}

/** Liste nach --aufraeumen oder --erfassen: nur Dateien, die es gibt und die noch groß sind, sortiert */
export function largeFiles(lines: Record<string, number>, candidates: string[]): string[] {
  return candidates.filter((file) => isLarge(lines[file] ?? 0)).sort((a, b) => a.localeCompare(b));
}

/** Alte Dateien, die im Pull Request gewachsen sind, mit Zeilen vorher und nachher */
export function grownOldFiles(
  before: Record<string, number>,
  after: Record<string, number>,
  oldFiles: string[],
): { file: string; before: number; after: number }[] {
  return oldFiles
    .filter((file) => file in before && file in after && after[file] > before[file])
    .map((file) => ({ file, before: before[file], after: after[file] }));
}
