import type { Db, Tx } from "../../db/index.ts";
import { type Company, versteuerungForYear } from "../stammdaten/index.ts";

const VERSTEUERUNG = { soll: "Soll-Versteuerung", ist: "Ist-Versteuerung" } as const;

/**
 * Gebucht wird nach der aktuellen Versteuerung, die Voranmeldung rechnet das Jahr aber nach der, die dort galt
 * (versteuerungForYear). Nach einem Wechsel zum Jahreswechsel stünde die Steuer einer Rechnung im Vorjahr sonst
 * zweimal in der Anmeldung (Soll → Ist) oder gar nicht (Ist → Soll). Beim Festschreiben und bei der Übernahme einer
 * Fremdrechnung gleichermaßen; leere Liste = in Ordnung.
 */
export async function versteuerungIssues(company: Company, issueDate: string, q: Db | Tx): Promise<string[]> {
  if (company.kleinunternehmer) return [];
  const year = Number(issueDate.slice(0, 4));
  const booked = await versteuerungForYear(year, q);
  if (booked === company.versteuerung) return [];
  return [
    `Das Jahr ${year} ist nach ${VERSTEUERUNG[booked]} gebucht, eingestellt ist jetzt ${VERSTEUERUNG[company.versteuerung]}; bitte ein Rechnungsdatum im laufenden Jahr wählen`,
  ];
}
