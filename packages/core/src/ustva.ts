import { z } from "zod/mini";
import { taxOf, type Cents } from "./money.ts";
import { vatPeriodSchema } from "./period.ts";

/**
 * Kennzahlen der Umsatzsteuer-Voranmeldung, die Haben derzeit unterstützt.
 * Kz 81 und 86 sind steuerpflichtige Bemessungsgrundlagen, Kz 21 (Reverse Charge im EU-Ausland),
 * 45 (nicht steuerbar) und 48 (steuerfrei ohne Vorsteuerabzug) Umsätze ohne Steuer; ELSTER erwartet
 * dort volle Euro. Kz 46 und 84 sind Bemessungsgrundlagen von Leistungen, für die du als Empfänger die Steuer
 * schuldest (§ 13b UStG), in vollen Euro; Kz 47 und 85 die Steuer dazu in Cent. Kz 66 ist Vorsteuer, Kz 67
 * die Vorsteuer aus § 13b, beide in Cent. Kz 83 wird gerechnet. Alle Werte dürfen negativ
 * sein, etwa wenn Gutschriften im Monat überwiegen.
 */
export const ustvaInputSchema = z.object({
  period: vatPeriodSchema,
  kz81: z.int(),
  kz86: z.int(),
  kz21: z._default(z.int(), 0),
  kz45: z._default(z.int(), 0),
  kz48: z._default(z.int(), 0),
  kz66: z.int(),
  kz46: z._default(z.int(), 0),
  kz47: z._default(z.int(), 0),
  kz84: z._default(z.int(), 0),
  kz85: z._default(z.int(), 0),
  kz67: z._default(z.int(), 0),
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
  /** § 13b: Bemessungsgrundlagen in vollen Euro, Steuer und Vorsteuer in Cent */
  kz46: Cents;
  kz47: Cents;
  kz84: Cents;
  kz85: Cents;
  kz67: Cents;
  /** Verbleibende Vorauszahlung; negativ = Erstattung */
  kz83: Cents;
}

/** Bemessungsgrundlagen gibt ELSTER nur in vollen Euro an; Cent fallen weg. */
export function toWholeEuros(cents: Cents): Cents {
  return Math.trunc(cents / 100) * 100;
}

export type UstvaValues = Pick<UstvaInput, "kz81" | "kz86" | "kz66"> &
  Partial<Pick<UstvaInput, "kz21" | "kz45" | "kz48" | "kz46" | "kz47" | "kz84" | "kz85" | "kz67">>;

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
    kz46: toWholeEuros(input.kz46 ?? 0),
    kz47: input.kz47 ?? 0,
    kz84: toWholeEuros(input.kz84 ?? 0),
    kz85: input.kz85 ?? 0,
    kz67: input.kz67 ?? 0,
    kz83: tax81 + tax86 + (input.kz47 ?? 0) + (input.kz85 ?? 0) - input.kz66 - (input.kz67 ?? 0),
  };
}
