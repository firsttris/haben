/*
 * Basiszinssatz nach § 247 BGB aus dem SDMX-Webservice der Deutschen Bundesbank
 * (https://statistiken.bundesbank.de/statistiken-de/hilfe-970224?article=bundesbank-sdmx-web-service-api-991208).
 * Zeitreihe BBIN1.M.DE.BBK.BBKBAS2.EUR.ME („Basiszinssatz gemäß BGB / Stand am Monatsende“, früher SU0115), in % p. a.
 * Sie hat einen Wert je Monat; der laufende Monat steht meist schon darin, ein neuer Satz zum 1. Januar oder 1. Juli
 * aber nicht immer sofort. Abgefragt als SDMX-CSV (Accept: text/csv).
 */

export const BASE_RATE_URL = "https://api.statistiken.bundesbank.de/rest/data/BBIN1/M.DE.BBK.BBKBAS2.EUR.ME?lastNObservations=1";

export interface PublishedBaseRate {
  /** Monat des Werts, JJJJ-MM */
  month: string;
  /** Basiszinssatz in Basispunkten, kann negativ sein (z. B. −88 ab 1. Juli 2016) */
  basisPoints: number;
}

/** Jüngster Wert aus der CSV-Antwort (Semikolon, Kopfzeile mit TIME_PERIOD und OBS_VALUE), oder null */
export function parseBaseRateCsv(csv: string): PublishedBaseRate | null {
  const [header, ...rows] = csv
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (!header) return null;
  const columns = header.split(";");
  const periodAt = columns.indexOf("TIME_PERIOD");
  const valueAt = columns.indexOf("OBS_VALUE");
  if (periodAt < 0 || valueAt < 0) return null;
  const rates = rows.flatMap((row) => {
    const cells = row.split(";");
    const month = cells[periodAt] ?? "";
    const value = (cells[valueAt] ?? "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^-?\d+(\.\d{1,2})?$/.test(value)) return [];
    return [{ month, basisPoints: Math.round(Number(value) * 100) }];
  });
  return rates.sort((a, b) => a.month.localeCompare(b.month)).at(-1) ?? null;
}

/** Monat der letzten Änderung des Basiszinssatzes (1. Januar oder 1. Juli, § 247 Abs. 1 Satz 2 BGB) vor oder an JJJJ-MM-TT */
export function lastBaseRateChange(today: string): string {
  return `${today.slice(0, 4)}-${Number(today.slice(5, 7)) >= 7 ? "07" : "01"}`;
}

/**
 * Muss der automatische Abruf laufen? Nur eingeschaltet und nur, solange der Satz für das laufende Halbjahr noch nicht
 * bestätigt ist: also nach dem 1. Januar und 1. Juli, bis die Bundesbank den neuen Satz meldet, sonst nie.
 */
export function baseRateRefreshDue(dunning: { autoBaseRate?: boolean; baseRateSince?: string | null }, today: string): boolean {
  return dunning.autoBaseRate === true && (dunning.baseRateSince ?? "") < lastBaseRateChange(today);
}

/**
 * Gilt der Wert dieses Monats für das laufende Halbjahr? Im Januar und Juli steht der neue Satz noch nicht in der Reihe;
 * ein Monat aus dem nächsten Halbjahr gilt erst ab dessen Stichtag (§ 247 Abs. 1 Satz 2 BGB). Also: derselbe Halbjahresbeginn.
 */
export function baseRateIsCurrent(month: string, today: string): boolean {
  return lastBaseRateChange(`${month}-01`) === lastBaseRateChange(today);
}
