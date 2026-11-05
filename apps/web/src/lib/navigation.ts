/** Bedingungen, unter denen ein Menüpunkt der Hauptnavigation erscheint */
export interface NavBedingung {
  nurEinzelunternehmen?: true;
  nurKapitalgesellschaft?: true;
  /** Erst mit dem ersten Mitarbeiter; ausgetretene zählen mit, ihre Ab- und Jahresmeldungen stehen noch an */
  nurMitMitarbeitern?: true;
}

export interface NavKontext {
  /** GmbH oder UG */
  gesellschaft: boolean;
  hatMitarbeiter: boolean;
}

export function navLinkSichtbar(link: NavBedingung, { gesellschaft, hatMitarbeiter }: NavKontext): boolean {
  if (gesellschaft && link.nurEinzelunternehmen) return false;
  if (!gesellschaft && link.nurKapitalgesellschaft) return false;
  return !(link.nurMitMitarbeitern && !hatMitarbeiter);
}
