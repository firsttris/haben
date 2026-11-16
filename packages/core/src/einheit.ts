/**
 * Zahl mit Einheit (#1132): zur Laufzeit eine schlichte Zahl, für den Compiler mit Einheit. Zwei verschiedene Einheiten
 * passen nicht zueinander, etwa Basispunkte an einer Stelle für Cent. Eine Zahl ohne Einheit passt weiter: Eine
 * Pflichtmarke hätte jede Summe und jede Zahl in Tests zu einem Fehler gemacht (Entscheidung in #1132). `as Cents`
 * meldet deshalb `bun run lint` (scripts/einheiten/).
 */
export type Einheit<E extends string> = number & { readonly __einheit?: E };
