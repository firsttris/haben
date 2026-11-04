import type { Cents } from "@haben/core";
import { anmeldungssteuern, anmeldungXml, checkSteuernummer13, element, ElsterEingabeError, type Datenlieferant, wholeEuros } from "./xml.ts";

/**
 * Antrag auf Dauerfristverlängerung und Anmeldung der Sondervorauszahlung (Vordruck USt 1 H, § 46–48 UStDV), über dieselbe
 * Datenart UStVA wie die Voranmeldung. Das ERiC-Plugin checkUStVA_2026 kennt dafür zwei Steuerfälle:
 * - Dauerfristverlaengerung (Jahr, Steuernummer, Kz09) für Unternehmer mit vierteljährlicher Abgabe,
 * - Umsatzsteuersondervorauszahlung (Jahr, Steuernummer, Kz09, Kz10, Kz38) für monatliche Abgabe: Der Antrag ist dann
 *   zugleich die Anmeldung der Sondervorauszahlung (§ 48 Abs. 1 Satz 4 UStDV), jedes Jahr neu (§ 48 Abs. 2 UStDV).
 * Kz38 ist Pflichtfeld („gegebenenfalls 0,-“) und laut ERiC in vollen Euro ohne Punkt und nicht negativ („Volle Geldbeträge …“).
 */
export interface DauerfristXmlInput {
  year: number;
  steuernummer13: string;
  /** Mit Betrag: Anmeldung der Sondervorauszahlung (monatliche Abgabe); ohne: nur der Antrag (vierteljährlich) */
  sondervorauszahlung: Cents | null;
  /** Berichtigte Anmeldung der Sondervorauszahlung (Kz 10) */
  berichtigt?: boolean;
  datenlieferant: Datenlieferant;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
  erstellungsdatum?: Date;
}

export function dauerfristNutzdaten(input: Omit<DauerfristXmlInput, "produktVersion" | "test">): string[] {
  checkSteuernummer13(input.steuernummer13);
  const kopf = [element("Jahr", String(input.year)), element("Steuernummer", input.steuernummer13), element("Kz09", input.herstellerId)];
  if (input.sondervorauszahlung === null) {
    if (input.berichtigt) throw new ElsterEingabeError("Einen Antrag auf Dauerfristverlängerung ohne Sondervorauszahlung kann man nicht berichtigen.");
    return anmeldungssteuern(input.year, input.datenlieferant, input.erstellungsdatum, [`<Dauerfristverlaengerung>`, ...kopf, `</Dauerfristverlaengerung>`]);
  }
  if (input.sondervorauszahlung < 0) throw new ElsterEingabeError("Die Sondervorauszahlung kann nicht negativ sein.");
  return anmeldungssteuern(input.year, input.datenlieferant, input.erstellungsdatum, [
    `<Umsatzsteuersondervorauszahlung>`,
    ...kopf,
    ...(input.berichtigt ? [element("Kz10", "1")] : []),
    element("Kz38", wholeEuros(input.sondervorauszahlung)),
    `</Umsatzsteuersondervorauszahlung>`,
  ]);
}

export function buildDauerfristXml(input: DauerfristXmlInput): string {
  return anmeldungXml(input, dauerfristNutzdaten(input));
}
