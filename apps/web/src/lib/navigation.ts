import { ACCENT_PATTERN, DEFAULT_ACCENT, inkOnAccent } from "@haben/core";

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

/**
 * Farbe des „H“ in der Navigation (#504): die Akzentfarbe der Belege, damit man jede Firma auf einen Blick erkennt.
 * Solange die Akzentfarbe ab Werk gilt, bleibt das Zeichen in der Farbe des Themes.
 */
export function markeInNavigation(accent: string): { farbe: string; schrift: string } | null {
  if (!ACCENT_PATTERN.test(accent)) return null;
  const farbe = accent.toUpperCase();
  return farbe === DEFAULT_ACCENT ? null : { farbe, schrift: inkOnAccent(farbe) };
}
