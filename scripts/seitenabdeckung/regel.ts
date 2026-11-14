/*
 * Jede Seite der App gehört in die Routenliste von e2e/seiten.spec.ts und in e2e/barrierefreiheit.spec.ts
 * (docs/mitwirken.md). Diese Regel vergleicht die Seiten aus dem Routenbaum von TanStack Router
 * mit den Pfaden, die in einer Spec-Datei vorkommen. Das ist ein Textvergleich: Er sieht, ob ein Pfad in der Datei
 * steht, nicht, ob ein Test die Seite wirklich lädt (Review von #463). Ein Aufruf, der nur eine 404 erwartet, zählt
 * deshalb als Treffer; solche Seiten stehen mit Grund in ausnahmen.ts.
 */

/** Grund für Lücken, die schon vor der Prüfung bestanden; sie verschwinden aus der Liste, sobald die Spec sie prüft */
export const OPEN = "noch offen";

/** Pfade, die keine Seite der App sind: API, OAuth-Metadaten (.well-known), Anmeldung ohne Sitzung, Einladung mit Token */
const NO_PAGE = [/^\/api\//, /^\/\.well-known\//, /^\/login$/, /^\/setup$/, /^\/einladung\//];

/** Seiten aus `FileRoutesByFullPath` in routeTree.gen.ts, Index-Routen ohne den Schrägstrich am Ende */
export function pagesOf(routeTree: string): string[] {
  const block = routeTree.match(/export interface FileRoutesByFullPath \{([^}]*)\}/)?.[1] ?? "";
  const paths = [...block.matchAll(/^\s*'([^']+)':/gm)].map(([, path]) => (path === "/" ? path : path.replace(/\/$/, "")));
  return [...new Set(paths)].filter((path) => !NO_PAGE.some((re) => re.test(path)));
}

/**
 * Pfade, die eine Spec-Datei aufruft: Strings und Template-Strings, die mit „/“ beginnen, ohne Query, und
 * die Muster von `firstLink(…, /^\/rechnungen\/[0-9a-f-]{36}$/)` als Pfad.
 */
export function pathsIn(spec: string): string[] {
  const literals = [...spec.matchAll(/["'`](\/(?:\$\{[^}]*\}|[^"'`\s$])*)["'`]/g)].map(([, path]) => path);
  const patterns = [...spec.matchAll(/\/\^((?:\\\/[^/\s]*)+)\$\//g)].map(([, source]) => source.replaceAll("\\/", "/"));
  return [...literals, ...patterns].map((path) => path.split("?")[0]);
}

/** Ein Parameter wie `$id` passt auf jedes Segment, auch auf `${YEAR}` oder `[0-9a-f-]{36}` */
function matcherOf(page: string): RegExp {
  const segments = page.split("/").map((segment) => (segment.startsWith("$") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return new RegExp(`^${segments.join("/")}$`);
}

/** 0 für ein festes Segment, 1 für einen Parameter */
const rankOf = (page: string) => page.split("/").map((segment) => (segment.startsWith("$") ? 1 : 0));

function compareRanks(a: number[], b: number[]): number {
  const index = a.findIndex((rank, i) => rank !== b[i]);
  return index === -1 ? 0 : a[index] - b[index];
}

/**
 * Die Seite, die der Router für einen Pfad wählt: Ein festes Segment geht vor einem Parameter (TanStack Router,
 * „Route Matching“), `/rechnungen/neu` ist also nicht `/rechnungen/$id`.
 */
function pageFor(pages: string[], path: string): string | undefined {
  return pages.filter((page) => matcherOf(page).test(path)).sort((a, b) => compareRanks(rankOf(a), rankOf(b)))[0];
}

const isCovered = (page: string, pages: string[], specPaths: string[]) => specPaths.some((path) => pageFor(pages, path) === page);

/** Seiten, die in keinem Pfad der Spec vorkommen und nicht ausdrücklich ausgenommen sind */
export function missingPages(pages: string[], specPaths: string[], exceptions: Record<string, string>): string[] {
  return pages.filter((page) => !(page in exceptions) && !isCovered(page, pages, specPaths));
}

/**
 * Ausnahmen, die verschwinden sollen: Seiten, die es nicht mehr gibt, und offene Lücken, die die Spec inzwischen
 * aufruft. Eine Ausnahme mit eigenem Grund bleibt, auch wenn der Pfad im Text der Spec steht (etwa als 404-Test).
 */
export function staleExceptions(pages: string[], specPaths: string[], exceptions: Record<string, string>): string[] {
  return Object.entries(exceptions)
    .filter(([page, reason]) => !pages.includes(page) || (reason === OPEN && isCovered(page, pages, specPaths)))
    .map(([page]) => page);
}
