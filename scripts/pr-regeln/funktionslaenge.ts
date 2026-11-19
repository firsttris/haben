import { grownFunctions } from "@firsttris/checks/checks/function-length.ts";
import type { Report } from "./regel.ts";

/*
 * Eine Funktion ab 80 Zeilen wird geteilt (docs/entwicklung.md, Konventionen). Biome zeigt lange Funktionen mit
 * noExcessiveLinesPerFunction nur als Info, auch alte; dieser Hinweis nennt die, die ein Pull Request neu anlegt oder
 * wachsen lässt. Gezählt wird mit dem Paket @firsttris/checks (checks/function-length.ts in firsttris/workflows) wie
 * Biome 2 mit skipBlankLines: jede Zeile des Rumpfs, die mit Code beginnt, ohne Kopf und Parameter, ohne Zeilen nur
 * mit Kommentar oder schließender Klammer, ohne Folgezeilen eines Template-Strings und ohne Text zwischen
 * JSX-Elementen. Hier stehen nur, welche Dateien zählen, und die Meldung auf Deutsch für den Kommentar im Pull Request.
 */

export const MAX_FUNCTION_LINES = 80;

/** Name einer Funktion ohne Namen in der Meldung, etwa `pruefen › (anonym)` für einen Rückruf in `pruefen` */
export const ANONYMOUS = "(anonym)";

const isTest = (file: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes("/e2e/") || file.includes("/test-fixtures/");

/** Code, den Biome mit der Grenze prüft: App, Pakete und Skripte, ohne Tests und Erzeugtes */
export function checksFunctions(file: string): boolean {
  return /^(apps\/[^/]+\/src|packages\/[^/]+\/src|scripts)\/.*\.[cm]?[jt]sx?$/.test(file) && !isTest(file) && !file.endsWith("routeTree.gen.ts");
}

/**
 * Hinweis auf Funktionen über der Grenze, die es vorher nicht gab, die vorher darunter lagen oder die gewachsen sind.
 * `before` ist null bei einer neuen Datei. Wächst eine schon lange Funktion, gehört das Neue in eine eigene; alte lange
 * Funktionen, die der Pull Request nicht verlängert, bleiben still: geteilt werden sie in einem eigenen Pull Request.
 */
export function functionLengthHints(changes: { file: string; before: string | null; after: string }[]): Report[] {
  return grownFunctions(
    changes.filter(({ file }) => checksFunctions(file)),
    MAX_FUNCTION_LINES,
    ANONYMOUS,
  ).map(({ file, name, lines, was }): Report => {
    const change =
      was === undefined
        ? `ist neu mit ${lines} Zeilen, mehr als ${MAX_FUNCTION_LINES}: vor dem Merge teilen`
        : was <= MAX_FUNCTION_LINES
          ? `wächst von ${was} auf ${lines} Zeilen, über ${MAX_FUNCTION_LINES}: vor dem Merge teilen`
          : `wächst von ${was} auf ${lines} Zeilen (Grenze ${MAX_FUNCTION_LINES}): das Neue vor dem Merge in eine eigene Funktion legen`;
    return { level: "warning", message: `${file}: Funktion „${name}“ ${change} (docs/entwicklung.md, Konventionen).` };
  });
}
