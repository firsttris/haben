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
  /** Kein Abruf ist mehr offen */
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

/** Grund, warum ein Abruf (alle Teile mit derselben `fetchId`) den Zeitraum nicht abschließt, sonst null */
function fetchProblem(parts: PartResult[]): string | null {
  const { from, to } = parts[0]!.coverage;
  if (parts.some((p) => p.coverage.from !== from || p.coverage.to !== to)) return "Die Teile der Lieferung nennen verschiedene Fenster.";
  const problem = partsProblem(parts);
  if (problem) return problem;
  const blocking = parts.reduce((sum, p) => sum + p.blocking, 0);
  if (blocking === 0) return null;
  const count = blocking === 1 ? "1 Ereignis ist" : `${blocking} Ereignisse sind`;
  return `${count} nicht übernommen (fremde Währung oder vom Connector nicht eingeordnet); der Zeitraum bleibt offen.`;
}

/**
 * Rückt den vollständig abgerufenen Zeitraum einer Quelle vor. Ein Abruf sind alle Teile mit derselben `fetchId`; ein
 * angenommener Teil allein ist noch kein vollständiger Zeitraum. Ein Abruf schließt sein Fenster ab, wenn alle Teile ab 0
 * bis zum letzten da sind, nichts offen ist und keine Lücke zum Stand bleibt. Ein abgebrochener Abruf hält den Stand nicht
 * auf, wenn ein späterer dasselbe Fenster vollständig liefert. Ein Konflikt hält ihn an, bis er geklärt ist. Ein Fenster
 * darf vor dem Stand beginnen, damit verspätete Bewegungen nachkommen; zurück geht der Stand nie.
 */
export function advanceCheckpoint(checkpoint: string | undefined, parts: PartResult[]): Checkpoint {
  if (parts.length === 0) return { checkpoint, complete: false, reason: "Keine Lieferung." };
  if (parts.some((p) => p.conflict)) return { checkpoint, complete: false, reason: "Die Lieferung hat einen Konflikt mit schon übernommenen Bewegungen." };
  const fetches = new Map<string, PartResult[]>();
  for (const p of parts) fetches.set(p.part.fetchId, [...(fetches.get(p.part.fetchId) ?? []), p]);
  const ordered = [...fetches.values()].sort((a, b) => (a[0]!.coverage.from < b[0]!.coverage.from ? -1 : a[0]!.coverage.from > b[0]!.coverage.from ? 1 : 0));
  let current = checkpoint;
  const open: { to: string; reason: string }[] = [];
  for (const group of ordered) {
    const { from, to } = group[0]!.coverage;
    const problem =
      fetchProblem(group) ?? (current && from > addDays(current, 1) ? `Lücke: vollständig bis ${current}, das Fenster beginnt erst am ${from}.` : null);
    if (problem) open.push({ to, reason: problem });
    else if (!current || to > current) current = to;
  }
  // Was ein späterer vollständiger Abruf abdeckt, ist nicht mehr offen
  const stillOpen = open.filter((o) => !current || o.to > current);
  return stillOpen.length === 0 ? { checkpoint: current, complete: true } : { checkpoint: current, complete: false, reason: stillOpen.at(-1)!.reason };
}
