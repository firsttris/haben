import { roundHalfAwayFromZero, type Cents } from "./money.ts";

/*
 * Abrechenbare Leistungen (#417): Dauer in Minuten lesen und zeigen, Betrag eines Eintrags. Die Dauer eines Eintrags
 * liegt zwischen einer Minute und einem Tag.
 */

const MAX_MINUTES = 24 * 60;

/**
 * Liest eine Dauer in ganzen Minuten: "1:30", "1,5" bzw. "1.5" (Stunden), "2", "1h 30min", "45 min". Null, wenn es keine
 * Dauer ist, null Minuten oder mehr als 24 Stunden herauskommen.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  let minutes: number | null = null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  const decimal = /^(\d{1,2})(?:[.,](\d{1,2}))?\s*(?:h|std\.?)?$/.exec(text);
  const split = /^(?:(\d{1,2})\s*(?:h|std\.?))?\s*(?:(\d{1,4})\s*(?:min\.?|m))?$/.exec(text);
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (decimal) minutes = Math.round(Number(`${decimal[1]}.${decimal[2] ?? "0"}`) * 60);
  else if (split && (split[1] !== undefined || split[2] !== undefined)) {
    // neben Stunden nur Minuten unter 60; "90 min" allein ist erlaubt
    if (split[1] === undefined || Number(split[2] ?? 0) <= 59) minutes = Number(split[1] ?? 0) * 60 + Number(split[2] ?? 0);
  }
  return minutes !== null && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null;
}

/** Stunden und Minuten, z. B. 90 → "1:30" */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Minuten mal Stundensatz (Cent je Stunde) auf ganze Cent; ein halber Cent rundet weg von null */
export function serviceAmount(minutes: number, hourlyRateCents: Cents): Cents {
  return roundHalfAwayFromZero((minutes * hourlyRateCents) / 60);
}
