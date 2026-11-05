/*
 * Optionale und alternative Positionen im Angebot, nach dem Vorbild von Lexware Office („Optionale und alternative
 * Positionen in Angeboten nutzen“, help.lexware.de Artikel 547989):
 *
 * - Optionale Positionen sind Zusatzleistungen, die der Kunde einzeln dazu bestellen kann.
 * - Eine Alternative steht unter ihrer Hauptposition (der normalen Position davor); der Kunde nimmt genau eine Variante,
 *   die Hauptposition oder eine ihrer Alternativen.
 *
 * Beide zählen nicht zur Angebotssumme. Beim Übernehmen in Rechnung oder Auftragsbestätigung wählt man aus; nicht gewählte
 * Positionen entfallen, gewählte stehen dort als normale Positionen.
 */

export const QUOTE_LINE_KINDS = ["optional", "alternative"] as const;

/** null = normale Position, die zur Summe zählt */
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const QUOTE_LINE_KIND_LABEL: Record<QuoteLineKind, string> = { optional: "Optional", alternative: "Alternative" };

interface KindLine {
  position: number;
  kind: QuoteLineKind | null;
}

/** Zählt zur Angebotssumme: nur normale Positionen */
export function countsInTotal(line: { kind: QuoteLineKind | null }): boolean {
  return line.kind === null;
}

/** Hauptposition einer Alternative: die letzte normale Position davor, über weitere Alternativen hinweg; sonst null */
export function alternativeMain<T extends KindLine>(lines: T[], position: number): number | null {
  const index = lines.findIndex((l) => l.position === position);
  if (index < 0 || lines[index]!.kind !== "alternative") return null;
  for (let i = index - 1; i >= 0; i--) {
    const kind = lines[i]!.kind;
    if (kind === null) return lines[i]!.position;
    if (kind !== "alternative") return null;
  }
  return null;
}

/** Aufbau prüfen: Alternativen direkt unter ihrer Hauptposition, mindestens eine Position zählt; null = in Ordnung */
export function quoteLineKindProblem<T extends KindLine>(lines: T[]): string | null {
  for (const line of lines) {
    if (line.kind === "alternative" && alternativeMain(lines, line.position) === null) {
      return `Position ${line.position}: Eine Alternative steht unter ihrer Hauptposition`;
    }
  }
  if (lines.length > 0 && !lines.some(countsInTotal)) return "Mindestens eine Position muss zur Angebotssumme zählen";
  return null;
}

/** Auswahl prüfen: gewählte Positionen (optionale und Alternativen) gehören zum Angebot, je Hauptposition eine Alternative */
export function choiceProblem<T extends KindLine>(lines: T[], chosen: number[]): string | null {
  const mains = new Set<number>();
  for (const position of chosen) {
    const line = lines.find((l) => l.position === position);
    if (!line) return `Position ${position} gibt es im Angebot nicht`;
    if (line.kind === null) return `Position ${position} ist weder optional noch Alternative`;
    if (line.kind === "alternative") {
      const main = alternativeMain(lines, position)!;
      if (mains.has(main)) return `Zu Position ${main} ist nur eine Alternative wählbar`;
      mains.add(main);
    }
  }
  return null;
}

/**
 * Positionen für Rechnung und Auftragsbestätigung nach der Auswahl: normale Positionen, außer eine ihrer Alternativen ist
 * gewählt (dann steht diese an ihrer Stelle), dazu die gewählten optionalen. Ohne Auswahl die Hauptpositionen.
 */
export function chosenLines<T extends KindLine>(lines: T[], chosen: number[]): T[] {
  const picked = new Set(chosen);
  const replaced = new Set(lines.filter((l) => l.kind === "alternative" && picked.has(l.position)).map((l) => alternativeMain(lines, l.position)));
  return lines.filter((l) => (l.kind === null ? !replaced.has(l.position) : picked.has(l.position)));
}
