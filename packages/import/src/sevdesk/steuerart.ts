import type { SevTaxSet } from "./types.ts";

/* Eigene Steuerart aus sevDesk (GET /TaxSet), gelesen für den Abgleich der Umsatzsteuer je Monat. */

export interface SevTaxSetFields {
  id: string;
  /** Steuersatz in Basispunkten */
  rate: number;
  /** Kennzahl der Bemessungsgrundlage, z. B. "46"; null ohne Angabe */
  net: string | null;
  /** Kennzahlen der Steuer, z. B. ["47", "67"] bei § 13b (Steuer und Vorsteuer) */
  tax: string[];
}

/** Kennzahlen als Text ohne Leerzeichen; sevDesk liefert mehrere durch Komma ("47,67") */
function fields(value: unknown): string[] {
  if (typeof value !== "string" && typeof value !== "number") return [];
  return String(value)
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** null, wenn der Satz keine Zahl ist: Dann lässt sich die Steuer nicht rechnen */
export function sevTaxSetFields(raw: SevTaxSet): SevTaxSetFields | null {
  const rate = Number(raw.taxRate ?? 0);
  if (!Number.isFinite(rate)) return null;
  // Mehrere Kennzahlen für die Bemessungsgrundlage kennt die Voranmeldung nicht; als Ganzes bleibt das unbekannt
  const net = fields(raw.vatReportFieldNet).join(",") || null;
  return { id: String(raw.id), rate: Math.round(rate * 100), net, tax: fields(raw.vatReportFieldTax) };
}
