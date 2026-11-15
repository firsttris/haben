/**
 * Zahl mit Einheit (#1132): zur Laufzeit eine schlichte Zahl, für den Compiler mit Einheit. Zwei verschiedene Einheiten
 * passen nicht zueinander, etwa Basispunkte an einer Stelle für Cent. Eine Zahl ohne Einheit passt noch, solange nicht
 * alle Ränder (Datenbank, Eingaben, Parser) Werte mit Einheit liefern.
 */
export type Einheit<E extends string> = number & { readonly __einheit?: E };
