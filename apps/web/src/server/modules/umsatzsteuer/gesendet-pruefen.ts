import { formatEuro, periodLabel, type Cents, type VatPeriod } from "@haben/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { computedValues } from "./vat.ts";

/*
 * Gesendete Voranmeldungen gegen die Rechnung aus dem Journal (#1116): Was gesendet ist, steht in vat_returns; rechnet
 * Haben den Zeitraum heute anders, hat eine Buchung oder eine Codeänderung ein angemeldetes Jahr still verändert. Je
 * Zeitraum zählt die zuletzt gesendete Anmeldung (auch eine Berichtigung). Bei von Hand überschriebenen Kennzahlen
 * (source „manuell“) wird mit den beim Speichern berechneten Werten verglichen (`computed`), nicht mit den gesendeten.
 */

/** Die gespeicherten Kennzahlen einer Anmeldung, wie computedValues sie liefert */
const FELDER = [
  "kz81",
  "kz86",
  "kz21",
  "kz45",
  "kz48",
  "kz66",
  "kz46",
  "kz47",
  "kz84",
  "kz85",
  "kz67",
  "kz41",
  "kz43",
  "kz89",
  "kz93",
  "kz61",
  "kz62",
  "kz39",
  "kz83",
] as const;

export interface GesendetAbweichung {
  period: VatPeriod;
  /** z. B. „Kz 81“ */
  feld: string;
  gesendet: Cents;
  journal: Cents;
}

/** Abweichungen der zuletzt gesendeten Anmeldungen der Jahre `years` von der Rechnung aus dem Journal */
export async function gesendeteAbweichungen(years: readonly number[], q: Db | Tx = db): Promise<GesendetAbweichung[]> {
  if (years.length === 0) return [];
  const r = schema.vatReturns;
  const sent = await q
    .select()
    .from(r)
    .where(and(inArray(r.year, [...years]), eq(r.status, "sent")))
    .orderBy(r.year, r.month, desc(r.sentAt));
  const latest = new Map<string, (typeof sent)[number]>();
  for (const row of sent) if (!latest.has(`${row.year}-${row.month}`)) latest.set(`${row.year}-${row.month}`, row);
  const result: GesendetAbweichung[] = [];
  for (const row of latest.values()) {
    const period = { year: row.year, month: row.month };
    const heute = await computedValues(period, q);
    const gespeichert: Partial<Record<(typeof FELDER)[number], number>> = row.source === "manuell" ? (row.computed ?? {}) : row;
    for (const feld of FELDER) {
      const gesendet = gespeichert[feld] ?? 0;
      if (gesendet !== heute[feld]) result.push({ period, feld: `Kz ${feld.slice(2)}`, gesendet, journal: heute[feld] });
    }
  }
  return result;
}

/** Kurztext einer Abweichung, z. B. für den Befund der Prüfung beim Update */
export function gesendetText(a: GesendetAbweichung): string {
  return `Voranmeldung ${periodLabel(a.period)}, ${a.feld}: gesendet ${formatEuro(a.gesendet)}, aus dem Journal ${formatEuro(a.journal)}`;
}
