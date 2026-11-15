import type { z } from "zod";
import type { FbEnvelope } from "./types.ts";

/* Lesen der Antworten von FastBill: Listen aus RESPONSE, Fehlertexte aus ERRORS, Schemafehler als Text. */

/**
 * Liste aus RESPONSE. Fehlt der erwartete Schlüssel, nimmt sie die einzige Liste der Antwort: Die Doku nennt
 * die Namen nur für Kunden. Ein einzelnes Objekt statt einer Liste wird zur Liste mit einem Eintrag; keine
 * Liste heißt keine Einträge.
 */
export function listOf(response: Record<string, unknown>, key: string): unknown[] {
  let value = response[key];
  if (value === undefined) {
    const lists = Object.entries(response).filter(([k, v]) => k !== "ERRORS" && (Array.isArray(v) || (v !== null && typeof v === "object")));
    if (lists.length === 1) value = lists[0]![1];
  }
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

export function errorTexts(errors: FbEnvelope["RESPONSE"]["ERRORS"]): string[] {
  if (errors === undefined || errors === null) return [];
  const items = Array.isArray(errors) ? errors : [errors];
  return items
    .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t !== "" && t !== "{}");
}

export function describeIssues(issues: readonly z.core.$ZodIssue[], prefix?: string): string {
  const shown = issues
    .slice(0, 3)
    .map((i) => {
      const path = [...(prefix ? [prefix] : []), ...i.path.map(String)];
      return `Feld „${path.length ? path.join(".") : "(Wurzel)"}“: ${i.message}`;
    })
    .join("; ");
  return issues.length > 3 ? `${shown} (und ${issues.length - 3} weitere)` : shown;
}
