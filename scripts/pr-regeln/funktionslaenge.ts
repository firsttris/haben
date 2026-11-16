import { parseSync } from "oxc-parser";
import type { Report } from "./regel.ts";

/*
 * Eine Funktion ab 80 Zeilen wird geteilt (docs/entwicklung.md, Konventionen). Biome zeigt lange Funktionen mit
 * noExcessiveLinesPerFunction nur als Info, auch alte; dieser Hinweis nennt die, die ein Pull Request neu anlegt oder
 * wachsen lässt. Den Code liest oxc-parser wie in scripts/modulgrenzen (die Compiler-API von TypeScript ist ab
 * Version 7 keine stabile Schnittstelle mehr). Gezählt wird wie Biome 2 mit skipBlankLines (biome.jsonc, Quelle:
 * crates/biome_js_analyze/src/lint/complexity/no_excessive_lines_per_function.rs): im Rumpf jedes Token, vor dem ein
 * Zeilenumbruch steht, außer `{` und `}`. Also jede Zeile des Rumpfs, die mit Code beginnt, ohne Kopf und Parameter,
 * ohne Zeilen nur mit Kommentar oder schließender Klammer, ohne Folgezeilen eines Template-Strings und ohne Text
 * zwischen JSX-Elementen.
 */

export const MAX_FUNCTION_LINES = 80;

type Node = { type: string; start: number; end: number; [key: string]: unknown };

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as Node).type === "string";
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
/** Hüllen, durch die der Name zur Funktion durchgeht: `const f = (() => {}) as T` */
const WRAPPERS = new Set(["ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"]);

/** Name eines Schlüssels oder Bezeichners: `a`, `"a"`, `[a]`; sonst null */
function keyName(node: unknown): string | null {
  if (!isNode(node)) return null;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") return String(node.name);
  if (node.type === "Literal") return String(node.value);
  if (node.type === "MemberExpression") return keyName(node.property);
  return null;
}

/** Kind eines Knotens, dem der Elternknoten einen Namen gibt: Variable, Eigenschaft, Methode, Klasse, Zuweisung */
function namedChild(node: Node): { key: string; name: string | null } | null {
  switch (node.type) {
    case "VariableDeclarator":
      return { key: "init", name: keyName(node.id) };
    case "MethodDefinition":
    case "Property":
    case "PropertyDefinition":
      return { key: "value", name: keyName(node.key) };
    case "AssignmentExpression":
      return { key: "right", name: keyName(node.left) };
    case "ClassDeclaration":
    case "ClassExpression":
      return { key: "body", name: keyName(node.id) };
    case "ExportDefaultDeclaration":
      return { key: "declaration", name: "default" };
    default:
      return null;
  }
}

type Found = { functions: { path: string[]; body: Node }[]; noToken: [number, number][] };

/**
 * Funktionen mit Namenspfad und Rumpf, dazu die Stellen, an denen eine Zeile ohne neues Token beginnt: im Text eines
 * Template-Strings nach dem Backtick und im Text zwischen JSX-Elementen bis zum nächsten Element einschließlich
 */
function collect(program: Node): Found {
  const found: Found = { functions: [], noToken: [] };
  // Getter und Setter prüft Biome nicht, Funktionen in ihnen schon
  const accessors = new Set<unknown>();
  const walk = (value: unknown, path: string[], named: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, path, false);
      return;
    }
    if (!isNode(value)) return;
    if (WRAPPERS.has(value.type)) {
      walk(value.expression, path, named);
      return;
    }
    if ((value.type === "MethodDefinition" || value.type === "Property") && (value.kind === "get" || value.kind === "set")) accessors.add(value.value);
    if (value.type === "TemplateElement") found.noToken.push([value.start + 1, value.end - 1]);
    if (value.type === "JSXText") found.noToken.push([value.start, value.end]);
    let inner = path;
    if (FUNCTIONS.has(value.type) && isNode(value.body) && !accessors.has(value)) {
      inner = named ? path : [...path, keyName(value.id) ?? "(anonym)"];
      found.functions.push({ path: inner, body: value.body });
    }
    const child = namedChild(value);
    for (const [key, field] of Object.entries(value)) {
      if (child && key === child.key && child.name !== null) walk(field, [...inner, child.name], true);
      else walk(field, inner, false);
    }
  };
  walk(program, [], false);
  return found;
}

/** Für jede Zeile die Stelle ihres ersten Tokens, -1 ohne: leer, nur Kommentar, im Template-String oder JSX-Text */
function firstTokens(code: string, comments: { start: number; end: number }[], noToken: [number, number][]): number[] {
  const mark = new Uint8Array(code.length + 1);
  for (const { start, end } of comments) mark.fill(1, start, end);
  for (const [start, end] of noToken) mark.fill(2, start, end + 1);
  const result: number[] = [];
  let lineStart = 0;
  while (lineStart <= code.length) {
    let i = lineStart;
    let first = -1;
    for (;;) {
      while (code[i] === " " || code[i] === "\t" || code[i] === "\r") i++;
      if (i >= code.length || code[i] === "\n" || mark[i] === 2) break;
      if (mark[i] !== 1) {
        first = i;
        break;
      }
      while (mark[i] === 1 && code[i] !== "\n") i++;
      if (code[i] === "\n" && mark[i] === 1) break; // Kommentar läuft in die nächste Zeile
    }
    result.push(first);
    const next = code.indexOf("\n", lineStart);
    if (next === -1) break;
    lineStart = next + 1;
  }
  return result;
}

/** Zeile zu einer Stelle im Code, über die Anfänge aller Zeilen */
const lineOf = (lineStarts: number[], offset: number) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

/**
 * Zeilen je Funktion wie bei Biome. Der Name ist der Pfad der umgebenden Namen, etwa `pruefen › (anonym)` für einen
 * Rückruf in `pruefen`; kommt ein Name mehrfach vor, zählt ein `#2` weiter, damit Basis und Kopf zueinander passen.
 */
export function functionLengths(file: string, code: string): Map<string, number> {
  const { program, comments } = parseSync(file, code);
  const { functions, noToken } = collect(program as unknown as Node);
  const tokens = firstTokens(code, comments, noToken);
  const lineStarts = [0, ...[...code.matchAll(/\n/g)].map((match) => (match.index ?? 0) + 1)];
  const lengths = new Map<string, number>();
  for (const { path, body } of functions) {
    let lines = 0;
    for (let line = lineOf(lineStarts, body.start); line <= lineOf(lineStarts, body.end); line++) {
      const at = tokens[line] ?? -1;
      if (at >= body.start && at < body.end && code[at] !== "{" && code[at] !== "}") lines++;
    }
    const base = path.join(" › ");
    let name = base;
    for (let n = 2; lengths.has(name); n++) name = `${base} #${n}`;
    lengths.set(name, lines);
  }
  return lengths;
}

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
  return changes
    .filter(({ file }) => checksFunctions(file))
    .flatMap(({ file, before, after }) => {
      const old = before === null ? new Map<string, number>() : functionLengths(file, before);
      return [...functionLengths(file, after)]
        .filter(([name, lines]) => lines > MAX_FUNCTION_LINES && lines > (old.get(name) ?? 0))
        .map(([name, lines]): Report => {
          const was = old.get(name);
          const change =
            was === undefined
              ? `ist neu mit ${lines} Zeilen, mehr als ${MAX_FUNCTION_LINES}: vor dem Merge teilen`
              : was <= MAX_FUNCTION_LINES
                ? `wächst von ${was} auf ${lines} Zeilen, über ${MAX_FUNCTION_LINES}: vor dem Merge teilen`
                : `wächst von ${was} auf ${lines} Zeilen (Grenze ${MAX_FUNCTION_LINES}): das Neue vor dem Merge in eine eigene Funktion legen`;
          return { level: "warning", message: `${file}: Funktion „${name}“ ${change} (docs/entwicklung.md, Konventionen).` };
        });
    });
}
