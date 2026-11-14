import type { UstErklaerungFigures } from "@haben/elster";
import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS } from "@haben/elster/euer-felder";
import { z } from "zod";

/*
 * Zeilen der Jahreserklärungen, die außerhalb von Haben abgegeben werden (#997): Schlüssel und amtlicher
 * Zeilentext. Hier, damit Oberfläche und Server dieselbe Liste lesen, ohne den Servercode zu laden.
 *
 * Die Schlüssel sind die der Übermittlung: `EUER_FIELDS` der Anlage EÜR (Feldkennungen und Zeilentexte aus der
 * Jahresdokumentation des ERiC-Pakets E77) und `UstErklaerungFigures` der Umsatzsteuererklärung. Eine eigene
 * Liste von Kennzahlen gab es hier einmal; sie war an die Zeilennummern eines Vordruckjahres gebunden (2024/2025:
 * Zeile 17 statt Kz 15) und deckte die Zeilen nicht ab, die Haben selbst übermittelt.
 */

/** Eine Zeile, die außerhalb von Haben erklärt wurde: Schlüssel der Erklärung und Zeilentext */
export interface ErklaerteZeile {
  /** Schlüssel wie in der Übermittlung: `steuerpflichtig`, `base19`, `gewinn`, … */
  field: string;
  text: string;
}

const euerZeile = (field: keyof typeof EUER_FIELDS): ErklaerteZeile => ({ field, text: EUER_FIELDS[field].label });

/**
 * Summenzeilen der Anlage EÜR. Sie stehen nicht in `EUER_FIELDS`, weil Haben sie rechnet und selbst ins XML
 * schreibt (E6005501, E6005301, E6007002); im Übermittlungsprotokoll stehen sie trotzdem.
 */
const EUER_SUMMEN = {
  einnahmen: { field: "einnahmen", text: "Summe der Betriebseinnahmen" },
  ausgaben: { field: "ausgaben", text: "Summe der Betriebsausgaben" },
  gewinn: { field: "gewinn", text: "Steuerpflichtiger Gewinn / Verlust" },
} as const satisfies Record<string, ErklaerteZeile>;

type UstBetrag = Exclude<keyof UstErklaerungFigures, "kz48Zeile47Nummern">;

/**
 * Zeilentexte der Umsatzsteuererklärung. Der Typ bindet die Liste an `UstErklaerungFigures`: eine fehlende oder
 * falsch geschriebene Kennzahl ist ein Übersetzungsfehler, keine stille Lücke.
 */
const UST_FELDER: Record<UstBetrag | "abschluss", string> = {
  base19: "Umsätze zu 19 %, Bemessungsgrundlage",
  tax19: "Umsatzsteuer auf Umsätze zu 19 %",
  base7: "Umsätze zu 7 %, Bemessungsgrundlage",
  tax7: "Umsatzsteuer auf Umsätze zu 7 %",
  kz41: "Steuerfreie innergemeinschaftliche Lieferungen (Kz 41)",
  kz43: "Steuerfreie Ausfuhrlieferungen (Kz 43)",
  kz21: "Nicht steuerbare Leistungen, Ort im EU-Ausland (Kz 21)",
  kz45: "Nicht steuerbare Umsätze Drittland (Kz 45)",
  kz46: "§-13b-Leistungen aus dem EU-Ausland, Bemessung (Kz 46)",
  kz47: "Steuer aus §-13b-Leistungen aus dem EU-Ausland (Kz 47)",
  kz84: "§-13b-Leistungen aus dem Drittland, Bemessung (Kz 84)",
  kz85: "Steuer aus §-13b-Leistungen aus dem Drittland (Kz 85)",
  kz89: "Innergemeinschaftliche Erwerbe zu 19 %, Bemessung (Kz 89)",
  tax89: "Steuer aus innergemeinschaftlichen Erwerben zu 19 % (Kz 89)",
  kz93: "Innergemeinschaftliche Erwerbe zu 7 %, Bemessung (Kz 93)",
  tax93: "Steuer aus innergemeinschaftlichen Erwerben zu 7 % (Kz 93)",
  kz48Zeile46: "Steuerfreie Umsätze ohne Vorsteuerabzug, Zeile 46: Vermietung (§ 4 Nr. 12 UStG)",
  kz48Zeile47: "Steuerfreie Umsätze ohne Vorsteuerabzug, Zeile 47: übrige (§ 4 UStG)",
  vorsteuer: "Abziehbare Vorsteuer aus Rechnungen (Kz 66)",
  kz61: "Vorsteuer aus innergemeinschaftlichem Erwerb (Kz 61)",
  kz62: "Entstandene Einfuhrumsatzsteuer (Kz 62)",
  kz67: "Vorsteuer aus §-13b-Leistungen (Kz 67)",
  vorauszahlungen: "Vorauszahlungssoll (Summe der Voranmeldungen des Jahres)",
  abschluss: "Abschlusszahlung / Erstattungsanspruch",
};

/** Die Reihenfolge der Umsatzsteuererklärung, vom Umsatz zur Abschlusszahlung */
const UST_REIHENFOLGE = [
  "base19",
  "tax19",
  "base7",
  "tax7",
  "kz41",
  "kz43",
  "kz21",
  "kz45",
  "kz46",
  "kz47",
  "kz84",
  "kz85",
  "kz89",
  "tax89",
  "kz93",
  "tax93",
  "kz48Zeile46",
  "kz48Zeile47",
  "vorsteuer",
  "kz61",
  "kz62",
  "kz67",
  "vorauszahlungen",
  "abschluss",
] as const satisfies readonly (keyof typeof UST_FELDER)[];

const ustZeile = (field: keyof typeof UST_FELDER): ErklaerteZeile => ({ field, text: UST_FELDER[field] });

/** Zeilen je Erklärungsart, in der Reihenfolge der amtlichen Vordrucke */
export const ERKLAERTE_ZEILEN = {
  ust: UST_REIHENFOLGE.map(ustZeile),
  euer: [
    ...EUER_EINNAHMEN.map(euerZeile),
    EUER_SUMMEN.einnahmen,
    ...EUER_AUSGABEN.map(euerZeile),
    EUER_SUMMEN.ausgaben,
    EUER_SUMMEN.gewinn,
    euerZeile("entnahmen"),
    euerZeile("einlagen"),
  ],
} as const satisfies Record<string, readonly ErklaerteZeile[]>;

export type ZeilenForm = keyof typeof ERKLAERTE_ZEILEN;

export const zeilenForm = z.enum(["ust", "euer"]);

/** Die Feldkennungen, die zu dieser Erklärungsart gehören */
export function zeilenFelder(form: ZeilenForm): readonly string[] {
  return ERKLAERTE_ZEILEN[form].map((z) => z.field);
}

/** Der Zeilentext zu einer gespeicherten Feldkennung */
export function zeilenText(form: ZeilenForm, field: string): string | undefined {
  return ERKLAERTE_ZEILEN[form].find((z) => z.field === field)?.text;
}
