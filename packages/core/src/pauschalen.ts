import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";

/**
 * Pauschalen ohne Beleg, die als Betriebsausgabe zählen (§ 4 Abs. 5 EStG):
 * - Tagespauschale für die Arbeit in der Wohnung (Homeoffice, § 4 Abs. 5 Satz 1 Nr. 6c EStG),
 * - Fahrten mit dem privaten Fahrzeug zu Kunden und auf Geschäftsreisen (Kilometersatz nach BRKG),
 * - Verpflegungsmehraufwand auf Geschäftsreisen im Inland (§ 9 Abs. 4a EStG).
 * Bezahlt wird privat, deshalb Ausgabe an Privateinlage.
 */

export type PauschaleArt = "homeoffice" | "fahrt" | "verpflegung";

export const PAUSCHALE_LABEL: Record<PauschaleArt, string> = {
  homeoffice: "Homeoffice-Tagespauschale",
  fahrt: "Fahrten mit dem Privatfahrzeug",
  verpflegung: "Verpflegungsmehraufwand",
};

/** Tagespauschale je Tag und Höchstzahl der Tage im Jahr: ab 2023 6 € für bis zu 210 Tage (1.260 €), 2020–2022 5 € für 120 Tage */
export function homeofficeSatz(year: number): { proTag: Cents; maxTage: number } | null {
  if (year >= 2023) return { proTag: 600, maxTage: 210 };
  if (year >= 2020) return { proTag: 500, maxTage: 120 };
  return null;
}

export type Fahrzeug = "pkw" | "andere";

/** Kilometersatz für betriebliche Fahrten mit dem Privatfahrzeug: Auto 0,30 €, andere motorisierte Fahrzeuge 0,20 € */
export const KM_SATZ: Record<Fahrzeug, Cents> = { pkw: 30, andere: 20 };

export const FAHRZEUG_LABEL: Record<Fahrzeug, string> = { pkw: "Auto", andere: "Motorrad, Roller oder Moped" };

/** Betrag einer Fahrt; km mit einer Nachkommastelle, gerundet auf Cent */
export function fahrtBetrag(km: number, fahrzeug: Fahrzeug): Cents {
  if (!(km > 0)) return 0;
  return Math.round(km * KM_SATZ[fahrzeug]);
}

/**
 * Art des Reisetags:
 * - eintaegig: ohne Übernachtung, mehr als 8 Stunden von Wohnung und erster Tätigkeitsstätte weg,
 * - anreise / abreise: An- oder Abreisetag einer Reise mit Übernachtung (ohne Mindestdauer),
 * - ganztag: voller Kalendertag (24 Stunden) unterwegs.
 */
export type Reisetag = "eintaegig" | "anreise" | "abreise" | "ganztag";

export const REISETAG_LABEL: Record<Reisetag, string> = {
  eintaegig: "Eintägig, mehr als 8 Stunden unterwegs",
  anreise: "Anreisetag (mit Übernachtung)",
  abreise: "Abreisetag (mit Übernachtung)",
  ganztag: "Voller Tag (24 Stunden unterwegs)",
};

/** Inland: ab 2020 14 € bzw. 28 €, davor 12 € bzw. 24 € */
export function verpflegungSaetze(year: number): { klein: Cents; gross: Cents } {
  return year >= 2020 ? { klein: 1400, gross: 2800 } : { klein: 1200, gross: 2400 };
}

export interface Mahlzeiten {
  fruehstueck?: boolean;
  mittag?: boolean;
  abend?: boolean;
}

/**
 * Verpflegungsmehraufwand eines Tages im Inland. Gestellte Mahlzeiten (vom Kunden, im Hotelpreis)
 * kürzen um 20 % (Frühstück) bzw. 40 % (Mittag, Abend) des Satzes für 24 Stunden, nie unter 0.
 */
export function verpflegungBetrag(year: number, tag: Reisetag, mahlzeiten: Mahlzeiten = {}): Cents {
  const { klein, gross } = verpflegungSaetze(year);
  const satz = tag === "ganztag" ? gross : klein;
  const kuerzung =
    (mahlzeiten.fruehstueck ? Math.round(gross * 0.2) : 0) +
    (mahlzeiten.mittag ? Math.round(gross * 0.4) : 0) +
    (mahlzeiten.abend ? Math.round(gross * 0.4) : 0);
  return Math.max(0, satz - kuerzung);
}

/**
 * Aufwandskonto je Pauschale; Gegenkonto ist die Privateinlage. Homeoffice auf dem Konto für das
 * häusliche Arbeitszimmer (abziehbarer Anteil), Fahrten und Verpflegung auf den Reisekosten des Unternehmers.
 */
export const PAUSCHALE_KONTEN: Record<PauschaleArt, Record<Kontenrahmen, { konto: string; name: string }>> = {
  homeoffice: {
    SKR03: { konto: "4288", name: "Häusliches Arbeitszimmer, Tagespauschale (abziehbar)" },
    SKR04: { konto: "6348", name: "Häusliches Arbeitszimmer, Tagespauschale (abziehbar)" },
  },
  fahrt: {
    SKR03: { konto: "4673", name: "Reisekosten Unternehmer Fahrtkosten" },
    SKR04: { konto: "6673", name: "Reisekosten Unternehmer Fahrtkosten" },
  },
  verpflegung: {
    SKR03: { konto: "4674", name: "Reisekosten Unternehmer Verpflegungsmehraufwand" },
    SKR04: { konto: "6674", name: "Reisekosten Unternehmer Verpflegungsmehraufwand" },
  },
};
