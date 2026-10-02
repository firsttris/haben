import { z } from "zod";
import { taxOf, type Cents } from "./money.ts";
import { vatPeriodSchema } from "./period.ts";

/**
 * Kennzahlen der Umsatzsteuer-Voranmeldung, die Haben derzeit unterstützt.
 * Kz 81 und 86 sind steuerpflichtige Bemessungsgrundlagen, Kz 21 (Reverse Charge im EU-Ausland),
 * 45 (nicht steuerbar) und 48 (steuerfrei ohne Vorsteuerabzug) Umsätze ohne Steuer; ELSTER erwartet
 * dort volle Euro. Kz 66 ist Vorsteuer in Cent, Kz 83 wird gerechnet. Alle Werte dürfen negativ
 * sein, etwa wenn Gutschriften im Monat überwiegen.
 */
export const ustvaInputSchema = z.object({
  period: vatPeriodSchema,
  kz81: z.number().int(),
  kz86: z.number().int(),
  kz21: z.number().int().default(0),
  kz45: z.number().int().default(0),
  kz48: z.number().int().default(0),
  kz66: z.number().int(),
});

export type UstvaInput = z.infer<typeof ustvaInputSchema>;

export interface UstvaFigures {
  /** Bemessungsgrundlage 19 % in Cent, auf volle Euro abgerundet */
  kz81: Cents;
  tax81: Cents;
  /** Bemessungsgrundlage 7 % in Cent, auf volle Euro abgerundet */
  kz86: Cents;
  tax86: Cents;
  /** Umsätze ohne Steuer in Cent, auf volle Euro abgerundet */
  kz21: Cents;
  kz45: Cents;
  kz48: Cents;
  kz66: Cents;
  /** Verbleibende Vorauszahlung; negativ = Erstattung */
  kz83: Cents;
}

/** Bemessungsgrundlagen gibt ELSTER nur in vollen Euro an; Cent fallen weg. */
export function toWholeEuros(cents: Cents): Cents {
  return Math.trunc(cents / 100) * 100;
}

export type UstvaValues = Pick<UstvaInput, "kz81" | "kz86" | "kz66"> & Partial<Pick<UstvaInput, "kz21" | "kz45" | "kz48">>;

export function computeUstva(input: UstvaValues): UstvaFigures {
  const kz81 = toWholeEuros(input.kz81);
  const kz86 = toWholeEuros(input.kz86);
  const tax81 = taxOf(kz81, 1900);
  const tax86 = taxOf(kz86, 700);
  return {
    kz81,
    tax81,
    kz86,
    tax86,
    kz21: toWholeEuros(input.kz21 ?? 0),
    kz45: toWholeEuros(input.kz45 ?? 0),
    kz48: toWholeEuros(input.kz48 ?? 0),
    kz66: input.kz66,
    kz83: tax81 + tax86 - input.kz66,
  };
}
