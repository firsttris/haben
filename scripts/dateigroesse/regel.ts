/*
 * Eine Datei tut eine Sache: ab etwa 400 Zeilen wird sie geteilt (CLAUDE.md, Code style). Ältere Dateien sind
 * größer; sie stehen mit ihrer heutigen Länge in grenzen.json und dürfen nicht weiter wachsen, nur schrumpfen
 * (Ratsche). So muss niemand sie nebenbei aufteilen, aber keine Datei wird neu zu groß.
 */

export const MAX_LINES = 400;

export type Limits = Record<string, number>;
export type Report = { file: string; message: string };

/** Zeilen wie `wc -l`, ein Zeilenumbruch am Ende zählt nicht als eigene Zeile */
export function countLines(code: string): number {
  if (code === "") return 0;
  return code.split("\n").length - (code.endsWith("\n") ? 1 : 0);
}

/** Verstöße: neue große Dateien, gewachsene alte; dazu Grenzen, die gesenkt werden können */
export function check(lines: Record<string, number>, limits: Limits): Report[] {
  const grown = Object.entries(lines).flatMap(([file, count]): Report[] => {
    const limit = limits[file] ?? MAX_LINES;
    if (count <= limit) return [];
    return [
      {
        file,
        message:
          file in limits
            ? `${count} Zeilen, war ${limit}: Die Datei darf nicht wachsen; Neues in eine eigene Datei auslagern.`
            : `${count} Zeilen, mehr als ${MAX_LINES}: Datei aufteilen, eine Datei tut eine Sache.`,
      },
    ];
  });
  const lowerable = Object.entries(limits).flatMap(([file, limit]): Report[] => {
    const count = lines[file];
    if (count !== undefined && count >= limit) return [];
    const now = count === undefined ? "gelöscht" : `${count} Zeilen`;
    return [{ file, message: `${now}, Grenze ${limit}: mit \`bun scripts/dateigroesse/pruefen.ts --senken\` senken.` }];
  });
  return [...grown, ...lowerable];
}

/** Neue Grenzen nach --senken: nur kleiner, Dateien bis MAX_LINES und gelöschte fallen heraus */
export function lowered(lines: Record<string, number>, limits: Limits): Limits {
  return Object.fromEntries(
    Object.entries(limits)
      .map(([file, limit]): [string, number] => [file, Math.min(limit, lines[file] ?? 0)])
      .filter(([, limit]) => limit > MAX_LINES)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
