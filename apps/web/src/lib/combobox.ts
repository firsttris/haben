/** Mehr Zeilen zeigt keine Trefferliste; wer mehr braucht, grenzt die Suche ein */
export const COMBOBOX_LIMIT = 50;

export interface SearchResult<T> {
  hits: T[];
  /** Alle Treffer vor der Begrenzung */
  total: number;
}

/** Vergleichsform: „Müller“ findet sich auch mit „muller“, „Maß“ mit „mass“ */
const normalize = (text: string) =>
  text
    .toLocaleLowerCase("de")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/**
 * Sucht in den Feldern eines Eintrags; jedes Wort der Eingabe muss vorkommen, in beliebiger Reihenfolge. Treffer am
 * Anfang des ersten Felds und genau passende Felder (eine Nummer) stehen vorn, sonst bleibt die Reihenfolge der Liste.
 */
export function searchOptions<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => (string | null | undefined)[],
  limit = COMBOBOX_LIMIT,
): SearchResult<T> {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { hits: items.slice(0, limit), total: items.length };
  const needle = terms.join(" ");
  const matches = items.flatMap((item) => {
    const values = fields(item).flatMap((value) => (value ? [normalize(value)] : []));
    // Derselbe Trenner wie in der Anzeige: Auch der angezeigte Text „Name · Ort“ findet seinen Eintrag wieder
    const text = values.join(" · ");
    if (!terms.every((term) => text.includes(term))) return [];
    return [{ item, front: values[0]?.startsWith(needle) || values.includes(needle) }];
  });
  const ordered = [...matches.filter((m) => m.front), ...matches.filter((m) => !m.front)];
  return { hits: ordered.slice(0, limit).map((m) => m.item), total: ordered.length };
}

/** Dieselbe Bezeichnung, verglichen wie in der Suche; ein leerer Text gleicht nichts */
export function sameEntry(a: string, b: string): boolean {
  const compare = (text: string) => normalize(text).replace(/\s+/g, " ").trim();
  return compare(a) !== "" && compare(a) === compare(b);
}

/**
 * Zeile, die ohne Pfeiltasten aktiv ist; -1 heißt: keine. Erst eine Suche macht den ersten Treffer zur Vorgabe, sonst
 * übernähmen Enter und Tab etwas, das niemand gesucht hat. Ohne Eingabe seit dem Öffnen steht der gewählte Eintrag da,
 * ein geleertes Feld wählt nichts.
 */
export function defaultRow({
  freeText,
  typed,
  text,
  selectedRow,
  rows,
}: {
  freeText: boolean;
  typed: boolean;
  text: string;
  selectedRow: number;
  rows: number;
}): number {
  if (freeText) return -1;
  if (!typed) return selectedRow;
  return text.trim() !== "" && rows > 0 ? 0 : -1;
}

/** Nächster aktiver Eintrag bei Pfeil hoch oder runter; -1 heißt: keiner, der Fokus steht im Feld */
export function moveActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return -1;
  if (key === "ArrowDown") return active + 1 >= count ? 0 : active + 1;
  return active <= 0 ? count - 1 : active - 1;
}

/** Was eine Taste im Feld mit der Liste bewirkt; `prevent` verhindert die Standardaktion, `stop` das Weiterreichen */
type ListKeyStep = { prevent: boolean; stop?: true } & ({ action: "open" | "close" } | { action: "move" | "commit"; row: number });

/**
 * Tasten nach dem WAI-ARIA-Muster der Combobox: Pfeile öffnen und bewegen, Alt+Pfeil öffnet und schließt, Enter übernimmt
 * (schickt aber nie das Formular ab), Escape schließt, Tab übernimmt nur mit commitOnTab und nie die Zeile zum Anlegen.
 * null heißt: Die Liste verbraucht die Taste nicht.
 */
export function listKey(
  key: string,
  altKey: boolean,
  { open, active, rows, createIndex, commitOnTab }: { open: boolean; active: number; rows: number; createIndex: number; commitOnTab: boolean },
): ListKeyStep | null {
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (altKey) return { action: key === "ArrowDown" ? "open" : "close", prevent: true };
    if (!open) return { action: "open", prevent: true };
    return { action: "move", row: moveActive(active, rows, key), prevent: true };
  }
  if (!open) return null;
  if (key === "Enter") return active >= 0 ? { action: "commit", row: active, prevent: true } : { action: "close", prevent: true };
  if (key === "Escape") return { action: "close", prevent: true, stop: true };
  if (key === "Tab" && commitOnTab && active >= 0 && active !== createIndex) return { action: "commit", row: active, prevent: false };
  return null;
}
