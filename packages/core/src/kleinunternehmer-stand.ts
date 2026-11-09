/*
 * Kleinunternehmer (§ 19 UStG) an einem Tag, aus den Änderungen im Protokoll der Firmendaten. Als Daten, damit Server
 * und Formulare denselben Stand lesen: Der Server prüft eine Bareinnahme gegen den Stand am Ende ihres Monats
 * (kleinunternehmerForMonth), das Formular bietet dafür die passende Steuerbehandlung an (#276).
 */

export interface KleinunternehmerStand {
  /** Änderungen in der Reihenfolge des Protokolls: Tag (JJJJ-MM-TT, deutsche Zeit) und neuer Wert */
  aenderungen: { date: string; value: boolean }[];
  /** Stand der Firmendaten heute; gilt, wenn das Protokoll nichts enthält */
  aktuell: boolean;
}

/** Status am Ende des Tages; vor dem ersten Eintrag gilt der erste bekannte Stand (Anlegen der Firmendaten) */
export function kleinunternehmerAm(stand: KleinunternehmerStand, date: string): boolean {
  const last = stand.aenderungen.filter((c) => c.date <= date).at(-1);
  return last ? last.value : (stand.aenderungen[0]?.value ?? stand.aktuell);
}

/** Status am Ende des Monats, in dem `date` liegt, wie die Voranmeldung ihn liest */
export function kleinunternehmerImMonat(stand: KleinunternehmerStand, date: string): boolean {
  const monatsende = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return kleinunternehmerAm(stand, monatsende);
}
