/**
 * Aus den gelesenen Zeilen den Plan des Imports: fehlerhafte Zeilen, Dubletten (gegen den Bestand und innerhalb der
 * Datei) und neue Datensätze. Übernommen werden nur die neuen; nichts wird doppelt angelegt oder überschrieben.
 */

/** Merkmal, an dem ein Datensatz wiedererkannt wird, etwa die Kundennummer */
export interface DuplicateKey {
  /** „Kundennummer“, „E-Mail“ … */
  label: string;
  /** Normalisiert verglichen (klein, ohne Leerraum am Rand) */
  value: string;
}

export interface RowCandidate<T> {
  line: number;
  /** Was die Vorschau je Zeile zeigt, etwa der Name */
  title: string;
  value: T | null;
  errors: string[];
  keys: DuplicateKey[];
}

export type PlannedRow<T> =
  | { line: number; title: string; status: "neu"; value: T; message: null }
  | { line: number; title: string; status: "dublette"; value: null; message: string }
  | { line: number; title: string; status: "fehler"; value: null; message: string };

export function duplicateKey(label: string, value: string | null | undefined): DuplicateKey[] {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized ? [{ label, value: normalized }] : [];
}

const id = (key: DuplicateKey) => `${key.label}\u0000${key.value}`;

export function planRows<T>(candidates: readonly RowCandidate<T>[], existing: readonly DuplicateKey[]): PlannedRow<T>[] {
  const known = new Set(existing.map(id));
  const inFile = new Map<string, number>();
  return candidates.map((row): PlannedRow<T> => {
    const base = { line: row.line, title: row.title };
    if (row.errors.length > 0 || row.value === null) return { ...base, status: "fehler", value: null, message: row.errors.join("; ") };
    const stored = row.keys.find((k) => known.has(id(k)));
    if (stored) return { ...base, status: "dublette", value: null, message: `Gibt es schon (${stored.label} ${stored.value})` };
    const twice = row.keys.find((k) => inFile.has(id(k)));
    if (twice) return { ...base, status: "dublette", value: null, message: `Wie Zeile ${inFile.get(id(twice))} (${twice.label} ${twice.value})` };
    for (const key of row.keys) inFile.set(id(key), row.line);
    return { ...base, status: "neu", value: row.value, message: null };
  });
}

export function planCounts(rows: readonly PlannedRow<unknown>[]): { neu: number; dublette: number; fehler: number } {
  return {
    neu: rows.filter((r) => r.status === "neu").length,
    dublette: rows.filter((r) => r.status === "dublette").length,
    fehler: rows.filter((r) => r.status === "fehler").length,
  };
}
