import { naechsterWerktag } from "./holidays.ts";
import type { Bundesland } from "./steuernummer.ts";

/**
 * Steuerliche Fristen: Abgabe der Jahreserklärungen ohne Steuerberater, Einkommensteuer-Vorauszahlungen.
 * Fällt eine Frist auf Samstag, Sonntag oder einen Feiertag am Sitz des Finanzamts, endet sie am nächsten
 * Werktag (§ 108 Abs. 3 AO).
 */

/**
 * Abgabefrist für Einkommensteuer-, Umsatzsteuererklärung und Anlage EÜR ohne Steuerberater (§ 149 Abs. 2 AO):
 * 31. Juli des Folgejahres. Für 2020 bis 2023 galten die verlängerten Fristen aus den Corona-Gesetzen.
 */
export function abgabefrist(veranlagungsjahr: number, bundesland: Bundesland | null): string {
  const verlaengert: Record<number, string> = {
    2020: "2021-11-01",
    2021: "2022-10-31",
    2022: "2023-10-02",
    2023: "2024-09-02",
  };
  return naechsterWerktag(verlaengert[veranlagungsjahr] ?? `${veranlagungsjahr + 1}-07-31`, bundesland);
}

/** Einkommensteuer-Vorauszahlungen: 10. März, Juni, September und Dezember (§ 37 Abs. 1 EStG) */
export function vorauszahlungstermine(year: number, bundesland: Bundesland | null): string[] {
  return ["03", "06", "09", "12"].map((month) => naechsterWerktag(`${year}-${month}-10`, bundesland));
}

/** Tage von heute bis zum Datum; negativ, wenn es vorbei ist */
export function tageBis(isoDate: string, today: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
