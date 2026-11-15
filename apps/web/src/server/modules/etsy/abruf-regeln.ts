import type { EtsyLedgerEntry } from "@haben/import";

/*
 * Regeln des Etsy-Abrufs ohne Datenbank: welcher Tag eine Zeile hat, bis wann Gebühren gebündelt werden und wo der
 * nächste Abruf beginnt. sync.ts wendet sie an; die Tests prüfen sie ohne Postgres.
 */

/** Überlappung in Tagen: Etsy trägt Zeilen nach, die kurz vor dem letzten Abruf entstanden sind */
export const OVERLAP_DAYS = 3;

/** Ab diesem Tag des Folgemonats wird ein Monat gebündelt; Etsy korrigiert die Gebühren bis dahin noch nachträglich */
export const BUENDEL_TAG = 5;

/** Buchungstag einer Zeile, in UTC wie im Parser */
export function dayOf(entry: EtsyLedgerEntry): string {
  return new Date((entry.created_timestamp ?? 0) * 1000).toISOString().slice(0, 10);
}

export function minusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Letzter Tag des Monats, bis zu dem Gebühren gebündelt werden (heute als JJJJ-MM-TT in deutscher Zeit): ab dem 5. der
 * Vormonat, davor der Monat davor.
 */
export function gebuehrenBisAm(heute: string): string {
  const [jahr, monat, tag] = heute.split("-").map(Number) as [number, number, number];
  const bisMonat = tag >= BUENDEL_TAG ? monat - 1 : monat - 2;
  return new Date(Date.UTC(jahr, bisMonat, 0)).toISOString().slice(0, 10);
}

/**
 * Erster Tag des nächsten Abrufs. Er beginnt drei Tage vor der jüngsten Zeile, damit nachgetragene Zeilen nicht
 * verloren gehen, spätestens aber am 1. des ersten noch nicht gebündelten Monats: Dessen Gebühren kommen erst später in
 * die Sammelzeile und müssen dann noch im Abruf liegen. Vor den bisherigen Start geht er nie zurück, damit kein Monat
 * vor dem gewählten „Abruf ab“ dazukommt. Reicht die Überlappung in einen schon gebündelten Monat, überspringt der
 * Import dessen Gebühren (schonGebuendelt in @haben/import).
 */
export function naechsterAbrufStart(tage: string[], fetchFrom: string, gebuehrenBis: string): string {
  const juengste = [...tage].sort().at(-1);
  if (!juengste) return fetchFrom;
  const ersterOffenerTag = minusDays(gebuehrenBis, -1);
  const kandidat = [minusDays(juengste, OVERLAP_DAYS), ersterOffenerTag].sort().at(0)!;
  return [kandidat, fetchFrom].sort().at(-1)!;
}

/** Wie oft der Zeitplan den Verlauf holt; Gebühren und Werbung kommen unabhängig davon einmal im Monat als Sammelzeile */
export const ETSY_RHYTHMEN = ["stuendlich", "taeglich", "woechentlich", "monatlich"] as const;
export type EtsyRhythmus = (typeof ETSY_RHYTHMEN)[number];

const STUNDE = 60 * 60 * 1000;
/** Abstand je Rhythmus mit etwas Luft, weil der Zeitplan selbst nur stündlich läuft */
const ABSTAND: Record<Exclude<EtsyRhythmus, "monatlich">, number> = {
  stuendlich: 50 * 60 * 1000,
  taeglich: 20 * STUNDE,
  woechentlich: 7 * 24 * STUNDE - 4 * STUNDE,
};

/**
 * Ist der automatische Abruf fällig? Monatlich heißt: einmal ab dem 5. (BUENDEL_TAG), wenn die Gebühren des Vormonats
 * gebündelt werden können. Nach einem Fehlschlag versucht es der Zeitplan spätestens nach einem Tag erneut, auch beim
 * wöchentlichen und monatlichen Rhythmus. `heute` und `letzterTag` sind Tage in deutscher Zeit (JJJJ-MM-TT).
 */
export function abrufFaellig(
  rhythmus: EtsyRhythmus,
  letzter: { zeit: Date; tag: string; fehlgeschlagen: boolean } | null,
  jetzt: Date,
  heute: string,
): boolean {
  if (!letzter) return true;
  const vergangen = jetzt.getTime() - letzter.zeit.getTime();
  if (letzter.fehlgeschlagen && vergangen >= ABSTAND.taeglich) return true;
  if (rhythmus !== "monatlich") return vergangen >= ABSTAND[rhythmus];
  const stichtag = `${heute.slice(0, 7)}-${String(BUENDEL_TAG).padStart(2, "0")}`;
  return heute >= stichtag && letzter.tag < stichtag;
}

/** Verteilung der Bestellungen nach dem Land des Käufers, als Hinweis im Abrufergebnis */
export function laenderHinweis(bestellungen: string[], laender: Map<string, string>): string | null {
  if (bestellungen.length === 0) return null;
  const zaehl = { DE: 0, US: 0, andere: 0, unbekannt: 0 };
  for (const id of bestellungen) {
    const land = laender.get(id);
    if (!land) zaehl.unbekannt++;
    else if (land === "DE") zaehl.DE++;
    else if (land === "US") zaehl.US++;
    else zaehl.andere++;
  }
  return `Bestellungen nach Land: ${zaehl.DE} Deutschland (19 %), ${zaehl.US} USA (nicht steuerbar, Kz 45), ${zaehl.andere} anderes Land (Steuer klären, keine Rechnung), ${zaehl.unbekannt} ohne Land.`;
}
