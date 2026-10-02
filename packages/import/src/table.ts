import { normalizeHeader } from "./text.ts";

/** Zugriff auf Spalten über ihren normalisierten Namen statt über die Position. */
export class Columns {
  private readonly names: string[];

  constructor(header: string[]) {
    this.names = header.map(normalizeHeader);
  }

  /** Erste Spalte, deren Name einem der Kandidaten entspricht oder mit ihm beginnt. */
  index(...candidates: string[]): number {
    for (const candidate of candidates) {
      const exact = this.names.indexOf(candidate);
      if (exact >= 0) return exact;
    }
    for (const candidate of candidates) {
      const prefix = this.names.findIndex((n) => n.startsWith(candidate));
      if (prefix >= 0) return prefix;
    }
    return -1;
  }

  has(...candidates: string[]): boolean {
    return this.index(...candidates) >= 0;
  }

  getter(...candidates: string[]): (row: string[]) => string {
    const i = this.index(...candidates);
    return (row) => (i < 0 ? "" : (row[i] ?? "").trim());
  }
}

export function findHeaderRow(rows: string[][], test: (columns: Columns) => boolean): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (test(new Columns(rows[i]!))) return i;
  }
  return -1;
}
