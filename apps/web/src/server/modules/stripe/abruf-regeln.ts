/*
 * Regeln des Stripe-Abrufs ohne Datenbank: wo der nächste Abruf beginnt und wann der Zeitplan abruft. sync.ts wendet sie
 * an; die Tests prüfen sie ohne Postgres.
 */

/**
 * Überlappung in Tagen: Der nächste Abruf beginnt so viele Tage vor dem Tag des letzten erfolgreichen. Eine Balance Transaction trägt ihren Zeitpunkt
 * (`created`) und ändert ihn nicht, kann aber kurz nach dem Abruf sichtbar werden; Haben erkennt schon übernommene an
 * ihrer Kennung und legt sie nicht noch einmal an.
 */
export const OVERLAP_DAYS = 3;

export function minusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Heute als Tag in UTC, wie Haben die Buchungstage der Balance Transactions bildet */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Erster Tag des nächsten Abrufs: drei Tage vor heute, aber nie vor dem bisherigen Start (`fetchFrom`) */
export function naechsterAbrufStart(fetchFrom: string, now: Date): string {
  return [minusDays(utcDay(now), OVERLAP_DAYS), fetchFrom].sort().at(-1)!;
}

/** Wie oft der Zeitplan abruft */
export const STRIPE_RHYTHMEN = ["stuendlich", "taeglich", "woechentlich"] as const;
export type StripeRhythmus = (typeof STRIPE_RHYTHMEN)[number];

const STUNDE = 60 * 60 * 1000;
/** Abstand je Rhythmus mit etwas Luft, weil der Zeitplan selbst nur stündlich läuft */
const ABSTAND: Record<StripeRhythmus, number> = {
  stuendlich: 50 * 60 * 1000,
  taeglich: 20 * STUNDE,
  woechentlich: 7 * 24 * STUNDE - 4 * STUNDE,
};

/**
 * Ist der automatische Abruf fällig? Nach einem Fehlschlag versucht es der Zeitplan spätestens nach einem Tag erneut,
 * auch beim wöchentlichen Rhythmus.
 */
export function abrufFaellig(rhythmus: StripeRhythmus, letzter: { zeit: Date; fehlgeschlagen: boolean } | null, jetzt: Date): boolean {
  if (!letzter) return true;
  const vergangen = jetzt.getTime() - letzter.zeit.getTime();
  if (letzter.fehlgeschlagen && vergangen >= ABSTAND.taeglich) return true;
  return vergangen >= ABSTAND[rhythmus];
}
