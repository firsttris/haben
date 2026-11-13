import { gesetzlicheFaelligkeit, type VatPeriod } from "./period.ts";

/*
 * Umsatzsteuer-Vorauszahlung um den Jahreswechsel in der EÜR (#583). Regelmäßig wiederkehrende Ausgaben, die kurze Zeit nach
 * Ende des Jahres abfließen, zu dem sie wirtschaftlich gehören, zählen in diesem Jahr (§ 11 Abs. 2 Satz 2 EStG); „kurze
 * Zeit“ sind höchstens zehn Tage, also der 22.12. bis 10.01. (H 11 EStH). Die Vorauszahlung ist eine solche Ausgabe; sie muss
 * in den zehn Tagen auch fällig sein (BFH X R 2/21), mit Dauerfristverlängerung ist die für Dezember erst am 10.02. fällig
 * (BFH VIII R 25/20). Fällt der 10.01. auf ein Wochenende, verschiebt § 108 Abs. 3 AO die Fälligkeit für § 11 EStG nicht
 * (BFH X R 44/16). Eine Erstattung bleibt im Jahr des Zuflusses: Ob sie regelmäßig wiederkehrt, steht nicht fest (#583).
 */

export interface UstVorauszahlung {
  /** Buchungstag der Bank, JJJJ-MM-TT */
  buchungstag: string;
  /** Zeitraum der Voranmeldung wie in vat_returns: Monat 1–12, Quartal 41–44 */
  zeitraum: VatPeriod;
  /** Dauerfristverlängerung im Jahr des Zeitraums */
  dauerfrist: boolean;
  /** Zahlung an das Finanzamt (Abfluss); false bei einer Erstattung */
  abfluss: boolean;
}

/**
 * Gehört die Zahlung in die EÜR des Vorjahres? Ja, wenn sie zwischen 1. und 10. Januar abfließt, die Voranmeldung für einen
 * Zeitraum des Vorjahres gilt und dessen Vorauszahlung zwischen 22.12. und 10.01. fällig ist. Eine Zahlung vom 22. bis
 * 31. Dezember zählt ohnehin in ihrem Jahr.
 */
export function ustVorauszahlungImVorjahr({ buchungstag, zeitraum, dauerfrist, abfluss }: UstVorauszahlung): boolean {
  const jahr = Number(buchungstag.slice(0, 4));
  if (!abfluss || zeitraum.year !== jahr - 1 || buchungstag > `${jahr}-01-10`) return false;
  const faellig = gesetzlicheFaelligkeit(zeitraum, dauerfrist);
  return faellig >= `${jahr - 1}-12-22` && faellig <= `${jahr}-01-10`;
}
