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

/** Nächster aktiver Eintrag bei Pfeil hoch oder runter; -1 heißt: keiner, der Fokus steht im Feld */
export function moveActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return -1;
  if (key === "ArrowDown") return active + 1 >= count ? 0 : active + 1;
  return active <= 0 ? count - 1 : active - 1;
}
