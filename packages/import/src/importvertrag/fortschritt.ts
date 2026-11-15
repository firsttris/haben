import { addDays } from "@haben/core";
import type { ImportBatch } from "./types.ts";

/** Ergebnis eines geprüften und eingeordneten Teils einer Lieferung, wie es Haben nach dem Speichern festhält */
export interface PartResult {
  coverage: ImportBatch["coverage"];
  part: ImportBatch["part"];
  /** Abgelehnte und nicht eingeordnete Ereignisse, die den Zeitraum offen lassen (`validateBatch`) */
  blocking: number;
  /** Konflikt mit schon übernommenen Bewegungen (`classifyMovements`) */
  conflict: boolean;
}

export interface Checkpoint {
  /** YYYY-MM-DD, bis einschließlich diesem Tag gilt die Quelle als vollständig abgerufen */
  checkpoint: string | undefined;
  complete: boolean;
  reason?: string;
}

/** Fehlt ein Teil, ist ein Teil doppelt oder steht `last` nicht am letzten: Grund, sonst null */
function partsProblem(parts: PartResult[]): string | null {
  const indexes = parts.map((p) => p.part.index).sort((a, b) => a - b);
  const missing = indexes.findIndex((index, position) => index !== position);
  if (missing >= 0)
    return indexes[missing] === indexes[missing - 1] ? `Teil ${indexes[missing]} der Lieferung kam doppelt.` : `Teil ${missing} der Lieferung fehlt.`;
  const last = parts.filter((p) => p.part.last);
  if (last.length === 0) return "Der letzte Teil der Lieferung fehlt.";
  if (last.length > 1 || last[0]!.part.index !== indexes.length - 1) return "Nach dem letzten Teil kam noch ein Teil.";
  return null;
}

/**
 * Rückt den vollständig abgerufenen Zeitraum einer Quelle vor, nach allen Teilen eines Fensters. Ein angenommener Teil
 * allein ist noch kein vollständiger Zeitraum: Es braucht alle Teile ab 0 bis zum letzten, keine offenen Ereignisse,
 * keinen Konflikt und keine Lücke zum bisherigen Stand. Ein Fenster darf vor dem Stand beginnen, damit verspätete
 * Bewegungen nachkommen; zurück geht der Stand nie.
 */
export function advanceCheckpoint(checkpoint: string | undefined, parts: PartResult[]): Checkpoint {
  const stay = (reason: string): Checkpoint => ({ checkpoint, complete: false, reason });
  if (parts.length === 0) return stay("Keine Lieferung.");
  const { from, to } = parts[0]!.coverage;
  if (parts.some((p) => p.coverage.from !== from || p.coverage.to !== to)) return stay("Die Teile der Lieferung nennen verschiedene Fenster.");
  const problem = partsProblem(parts);
  if (problem) return stay(problem);
  if (parts.some((p) => p.conflict)) return stay("Die Lieferung hat einen Konflikt mit schon übernommenen Bewegungen.");
  const blocking = parts.reduce((sum, p) => sum + p.blocking, 0);
  if (blocking > 0) {
    const count = blocking === 1 ? "1 Ereignis ist" : `${blocking} Ereignisse sind`;
    return stay(`${count} nicht übernommen (fremde Währung oder vom Connector nicht eingeordnet); der Zeitraum bleibt offen.`);
  }
  if (checkpoint && from > addDays(checkpoint, 1)) return stay(`Lücke: vollständig bis ${checkpoint}, das Fenster beginnt erst am ${from}.`);
  return { checkpoint: checkpoint && checkpoint > to ? checkpoint : to, complete: true };
}
