import { z } from "zod";

/*
 * Zeilen der Jahreserklärungen, die außerhalb von Haben abgegeben werden (#997): Feldkennung und amtlicher
 * Zeilentext. Hier, damit Oberfläche und Server dieselbe Liste lesen, ohne den Servercode zu laden.
 */

/** Zeilen je Erklärungsart, in der Reihenfolge der amtlichen Vordrucke */
export const ERKLAERTE_ZEILEN = {
  ust: [
    ["kz22", "Lieferungen und sonstige Leistungen zu 19 %"],
    ["kz37", "Steuer daraus"],
    ["kz51", "Innergemeinschaftliche Erwerbe zu 19 %"],
    ["kz56", "Steuer daraus"],
    ["kz65", "Sonstige Leistungen nach § 3a Abs. 2 UStG (§ 13b)"],
    ["kz67", "Andere Leistungen (§ 13b Abs. 2)"],
    ["kz68", "Summe der Steuer nach § 13b"],
    ["kz79", "Vorsteuer aus Rechnungen anderer Unternehmer"],
    ["kz80", "Vorsteuer aus innergemeinschaftlichen Erwerben"],
    ["kz83", "Vorsteuer aus Leistungen nach § 13b"],
    ["kz87", "Summe der Vorsteuerbeträge"],
    ["kz103", "Umsatzsteuer auf Lieferungen und Leistungen"],
    ["kz104", "Umsatzsteuer auf innergemeinschaftliche Erwerbe"],
    ["kz107", "Umsatzsteuer, die der Leistungsempfänger schuldet"],
    ["kz108", "Zwischensumme"],
    ["kz109", "Abziehbare Vorsteuerbeträge"],
    ["kz111", "Verbleibender Betrag"],
    ["kz116", "Umsatzsteuer-Überschuss"],
    ["kz118", "Verbleibende Umsatzsteuer / Verbleibender Überschuss"],
    ["kz119", "Vorauszahlungssoll"],
    ["kz120", "Abschlusszahlung / Erstattungsanspruch"],
  ],
  euer: [
    ["kz15", "Umsatzsteuerpflichtige Betriebseinnahmen"],
    ["kz17", "Vereinnahmte Umsatzsteuer"],
    ["einnahmen", "Summe Betriebseinnahmen"],
    ["kz29", "Bezogene Fremdleistungen"],
    ["kz33", "AfA auf bewegliche Wirtschaftsgüter"],
    ["kz36", "Geringwertige Wirtschaftsgüter (§ 6 Abs. 2 EStG)"],
    ["kz43", "Telekommunikation"],
    ["kz50", "Laufende EDV-Kosten"],
    ["kz51", "Arbeitsmittel"],
    ["kz57", "Abziehbare Vorsteuerbeträge"],
    ["kz65", "Häusliches Arbeitszimmer"],
    ["kz70", "Sonstige tatsächliche Fahrtkosten"],
    ["ausgaben", "Summe Betriebsausgaben"],
    ["gewinn", "Steuerpflichtiger Gewinn / Verlust"],
    ["entnahmen", "Entnahmen"],
    ["einlagen", "Einlagen"],
  ],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;

export type ZeilenForm = keyof typeof ERKLAERTE_ZEILEN;

export const zeilenForm = z.enum(["ust", "euer"]);

/** Die Feldkennungen, die zu dieser Erklärungsart gehören */
export function zeilenFelder(form: ZeilenForm): readonly string[] {
  return ERKLAERTE_ZEILEN[form].map(([feld]) => feld);
}
