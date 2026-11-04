import {
  computeUstva,
  frequencyAt,
  monthsOfPeriod,
  periodLabel,
  periodMatchesFrequency,
  suggestFrequency,
  type Cents,
  type FrequencySuggestion,
  type VatFrequency,
  type VatFrequencySetting,
  type VatPeriod,
} from "@haben/core";
import { and, eq, gte, min } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { computeVatFigures } from "./vat-figures.ts";
import { VatError } from "./vat.ts";

/*
 * Voranmeldungszeitraum je Jahr (§ 18 Abs. 2 UStG). Das Finanzamt legt ihn fest; Haben speichert, was der Nutzer einträgt,
 * und schlägt aus der Steuer des Vorjahres einen Zeitraum vor. Gesendete Voranmeldungen bleiben, wie sie sind: Eine
 * Einstellung, zu der eine gesendete nicht mehr passt, lehnt Haben ab.
 */

export async function loadFrequencies(q: Db | Tx = db): Promise<VatFrequencySetting[]> {
  return q
    .select({ year: schema.vatFrequencies.year, fromMonth: schema.vatFrequencies.fromMonth, frequency: schema.vatFrequencies.frequency })
    .from(schema.vatFrequencies)
    .orderBy(schema.vatFrequencies.year, schema.vatFrequencies.fromMonth);
}

export interface FrequencyInput {
  year: number;
  /** 1, 4, 7 oder 10: ein Wechsel im Jahr nur zu Beginn eines Quartals */
  fromMonth: number;
  frequency: VatFrequency;
}

/** Die Einstellungen nach dem Speichern: ersetzt ab diesem Monat alles im selben Jahr */
export function withFrequency(settings: readonly VatFrequencySetting[], input: FrequencyInput): VatFrequencySetting[] {
  return [...settings.filter((s) => s.year !== input.year || s.fromMonth < input.fromMonth), input].sort(
    (a, b) => a.year - b.year || a.fromMonth - b.fromMonth,
  );
}

/**
 * Speichert den Zeitraum ab Jahr und Monat. Abgelehnt, wenn danach eine gesendete Voranmeldung nicht mehr zu ihrem
 * Zeitraum passt. Entwürfe für Zeiträume, die es danach nicht mehr gibt, bleiben stehen (mit ihrem Prüfverlauf), lassen
 * sich aber nicht mehr senden; `orphanedDrafts` nennt sie.
 */
export async function saveFrequency(actor: string, input: FrequencyInput): Promise<{ orphanedDrafts: string[] }> {
  return withActor(actor, async (tx) => {
    const next = withFrequency(await loadFrequencies(tx), input);
    const returns = await tx
      .select({ id: schema.vatReturns.id, year: schema.vatReturns.year, month: schema.vatReturns.month, status: schema.vatReturns.status })
      .from(schema.vatReturns)
      .where(gte(schema.vatReturns.year, input.year));
    const conflicts = returns.filter((r) => !periodMatchesFrequency(next, r));
    const sent = conflicts.filter((r) => r.status === "sent");
    if (sent.length > 0) {
      const labels = [...new Set(sent.map((r) => periodLabel(r)))].join(", ");
      throw new VatError(
        `Für ${labels} ist schon eine Voranmeldung gesendet, die zu diesem Zeitraum nicht passt. Gesendete Voranmeldungen bleiben, wie sie sind; wähle den Wechsel ab einem späteren Quartal.`,
      );
    }
    await tx.delete(schema.vatFrequencies).where(and(eq(schema.vatFrequencies.year, input.year), gte(schema.vatFrequencies.fromMonth, input.fromMonth)));
    await tx.insert(schema.vatFrequencies).values({ ...input, updatedAt: new Date() });
    return { orphanedDrafts: conflicts.map((r) => periodLabel(r)) };
  });
}

/** Steuer eines Jahres aus den Buchungen: Summe der Zahllast der vier Quartale, negativ = Überschuss */
export async function yearTax(year: number): Promise<Cents> {
  const quarters = await Promise.all([41, 42, 43, 44].map((month) => computeVatFigures({ year, month })));
  return quarters.reduce((sum, figures) => sum + computeUstva(figures).kz83, 0);
}

export interface FrequencyOverview {
  year: number;
  /** Einstellungen dieses Jahres; leer = übernommen aus einem früheren Jahr oder monatlich */
  own: VatFrequencySetting[];
  /** Zeitraum im Januar des Jahres */
  frequency: VatFrequency;
  /** Ohne eigene Einstellung aus einem früheren Jahr übernommen */
  inherited: boolean;
  /** Steuer des Vorjahres aus den Buchungen; null ohne Buchungen im Vorjahr */
  previousYearTax: Cents | null;
  suggestion: FrequencySuggestion | null;
}

/** Einstellung und Vorschlag für ein Jahr, für die Seite der Voranmeldung */
export async function frequencyOverview(year: number, settings?: VatFrequencySetting[]): Promise<FrequencyOverview> {
  const all = settings ?? (await loadFrequencies());
  const [first] = await db.select({ date: min(schema.journalEntries.date) }).from(schema.journalEntries);
  const firstActivity = first?.date?.slice(0, 7) ?? null;
  const hasPreviousYear = firstActivity !== null && Number(firstActivity.slice(0, 4)) < year;
  const previousYearTax = hasPreviousYear ? await yearTax(year - 1) : null;
  return {
    year,
    own: all.filter((s) => s.year === year),
    frequency: frequencyAt(all, { year, month: 1 }),
    inherited: !all.some((s) => s.year === year) && all.some((s) => s.year < year),
    previousYearTax,
    suggestion: suggestFrequency({ year, previousYearTax, firstActivity }),
  };
}

/** Passt der Zeitraum zur Einstellung? Sonst die Meldung für den Nutzer */
export function periodProblem(settings: readonly VatFrequencySetting[], period: VatPeriod): string | null {
  if (periodMatchesFrequency(settings, period)) return null;
  const frequency = frequencyAt(settings, monthsOfPeriod(period)[0]!);
  if (frequency === "keine")
    return `Für ${periodLabel(period)} ist keine Voranmeldung eingestellt (befreit). Ändere den Voranmeldungszeitraum, wenn das nicht stimmt.`;
  return `Für ${periodLabel(period)} passt die Voranmeldung nicht zum eingestellten Zeitraum (${frequency === "vierteljaehrlich" ? "vierteljährlich" : "monatlich"}).`;
}
