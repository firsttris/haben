/**
 * Bereiche, die sich ausblenden lassen (#266, Stufe 1). Ausblenden nimmt nur die Menüpunkte aus Navigation und
 * Schnellsuche; Daten, Buchungen, Auswertungen, API und direkte Links bleiben. Rechnungen, Belege, Bank, Umsatzsteuer
 * und Jahreserklärung stehen nicht in der Liste: Ohne sie geht keine Buchhaltung.
 */
export const BEREICHE = [
  { id: "angebote", label: "Angebote", frage: "Schreibst du Angebote?", menue: "Angebote", seiten: ["/angebote"] },
  { id: "personal", label: "Personal", frage: "Hast du Angestellte oder Minijobber?", menue: "Lohn, SV-Meldeportal", seiten: ["/lohn", "/sv-meldeportal"] },
  { id: "kasse", label: "Kasse", frage: "Nimmst du Bargeld ein?", menue: "Kasse", seiten: ["/kasse"] },
  { id: "lastschriften", label: "Lastschriften", frage: "Ziehst du Geld per Lastschrift ein?", menue: "Lastschriften", seiten: ["/lastschriften"] },
  { id: "anlagen", label: "Anlagen und Darlehen", frage: "Hast du Anlagegüter oder Darlehen?", menue: "Anlagen, Darlehen", seiten: ["/anlagen", "/darlehen"] },
] as const;

export type BereichId = (typeof BEREICHE)[number]["id"];

export const BEREICH_IDS = BEREICHE.map((b) => b.id) as [BereichId, ...BereichId[]];

/** Pfade der Menüpunkte, die zu den ausgeblendeten Bereichen gehören; Unbekanntes aus älteren Ständen zählt nicht */
export function ausgeblendeteSeiten(ausgeblendet: readonly string[]): ReadonlySet<string> {
  return new Set(BEREICHE.filter((b) => ausgeblendet.includes(b.id)).flatMap((b) => b.seiten));
}
