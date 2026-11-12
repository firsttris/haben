import { ACCENT_PATTERN, inkOnAccent } from "@haben/core";

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

/** Zeichen der Firma in der Navigation (#504): Logo der Belege, „H“ in eigener Farbe oder null für das „H“ des Themes */
export type NavMark = { logo: string } | { background: string; ink: "#FFFFFF" | "#000000" } | null;

/**
 * Was die Navigation zeigt: das Logo, wenn es gewählt ist und es eins gibt (`logoSha256`), sonst die eigene Farbe mit
 * der Schrift nach dem höheren Kontrast. Die Prüfsumme in der Adresse lädt ein neues Logo, ohne dass ein Cache stört.
 */
export function navMark(setting: { color: string | null; logo: boolean }, logoSha256: string | null): NavMark {
  if (setting.logo && logoSha256) return { logo: `/api/kennzeichen?v=${logoSha256.slice(0, 16)}` };
  if (setting.color && ACCENT_PATTERN.test(setting.color)) return { background: setting.color.toUpperCase(), ink: inkOnAccent(setting.color) };
  return null;
}

/** Name der Firma unter „Haben“, damit man sieht, in welcher Instanz man bucht (#504); ohne Namen nichts */
export function firmaInNavigation(name: string): string | null {
  return name.trim() || null;
}
