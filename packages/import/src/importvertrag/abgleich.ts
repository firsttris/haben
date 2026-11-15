import { createHash } from "node:crypto";
import type { ImportBatch, ImportMovement, SourceBinding } from "./types.ts";

/*
 * Wiederholung und Konflikt. Bewegungen erkennt Haben an ihrer Quellenidentität (Quelle, Kontokennung, Ereignis,
 * Komponente), nicht an Betrag und Text wie `dedup.ts` bei Dateien: Gleichartige Umsätze mit verschiedenen Kennungen
 * bleiben getrennt, dieselbe Kennung über Seiten und Abrufe hinweg zählt einmal.
 */

/** Schlüssel einer Bewegung je Quellenbindung; unabhängig von Verbindung, Zugangsdaten und Stichtag */
export function movementKey(binding: Pick<SourceBinding, "provider" | "externalAccountId">, m: Pick<ImportMovement, "sourceEventId" | "component">): string {
  return JSON.stringify([binding.provider, binding.externalAccountId, m.sourceEventId, m.component]);
}

/** JSON mit sortierten Schlüsseln, damit derselbe Inhalt unabhängig von der Reihenfolge der Felder gleich ist */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Prüfwert des kanonischen Inhalts einer geprüften Lieferung */
export function batchFingerprint(batch: ImportBatch): string {
  return sha256(canonical(batch));
}

export type BatchClassification = { outcome: "new" } | { outcome: "replay" } | { outcome: "conflict"; message: string };

/**
 * Gleicher Schlüssel und gleicher Inhalt: dieselbe Lieferung noch einmal, etwa nach verlorener Antwort; Haben gibt das
 * bisherige Ergebnis zurück. Gleicher Schlüssel mit anderem Inhalt ist ein Konflikt.
 */
export function classifyBatch(previous: { fingerprint: string } | undefined, batch: ImportBatch): BatchClassification {
  if (!previous) return { outcome: "new" };
  if (previous.fingerprint === batchFingerprint(batch)) return { outcome: "replay" };
  return { outcome: "conflict", message: `Lieferung ${batch.idempotencyKey} kam schon mit anderem Inhalt; Haben nimmt sie nicht noch einmal an.` };
}

/** Buchungsrelevanter Kern: Ändert er sich, ist es ein Konflikt, kein Update */
type Core = Pick<ImportMovement, "amount" | "currency" | "bookingDate">;

/** Was Haben zu einer übernommenen Bewegung festhält, um spätere Lieferungen einzuordnen */
export interface KnownMovement {
  core: Core;
  /** Prüfwert aller Angaben; weicht er bei gleichem Kern ab, ist die Lieferung eine Beobachtung */
  details: string;
}

export function knownMovement(m: ImportMovement): KnownMovement {
  return { core: { amount: m.amount, currency: m.currency, bookingDate: m.bookingDate }, details: sha256(canonical(m)) };
}

export type MovementOutcome = "new" | "known" | "observation" | "conflict";

const CORE_LABELS: [keyof Core, string][] = [
  ["amount", "Betrag"],
  ["currency", "Währung"],
  ["bookingDate", "Buchungstag"],
];

/**
 * Ordnet die Bewegungen einer geprüften Lieferung gegen die schon übernommenen ein. Eine Beobachtung (gleicher Kern, andere
 * Angaben, etwa ein später geschwärzter Name) ergänzt nur die Herkunft, ein Konflikt überschreibt nichts; mit einem
 * Konflikt nimmt Haben die ganze Lieferung nicht an.
 */
export function classifyMovements(
  known: ReadonlyMap<string, KnownMovement>,
  binding: Pick<SourceBinding, "provider" | "externalAccountId">,
  movements: ImportMovement[],
): { results: { key: string; movement: ImportMovement; outcome: MovementOutcome }[]; conflicts: string[] } {
  const conflicts: string[] = [];
  const results = movements.map((movement) => {
    const key = movementKey(binding, movement);
    const before = known.get(key);
    if (!before) return { key, movement, outcome: "new" as const };
    const changed = CORE_LABELS.filter(([field]) => before.core[field] !== movement[field]);
    if (changed.length > 0) {
      const list = changed.map(([field, name]) => `${name} ${before.core[field]} → ${movement[field]}`).join(", ");
      conflicts.push(`${movement.sourceEventId}/${movement.component}: ${list}; nichts überschrieben.`);
      return { key, movement, outcome: "conflict" as const };
    }
    return { key, movement, outcome: before.details === knownMovement(movement).details ? ("known" as const) : ("observation" as const) };
  });
  return { results, conflicts };
}
