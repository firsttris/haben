import type { LayoutDocumentType } from "@haben/core";
import { nennt } from "./layout-pflicht.ts";
import { LAYOUT_GESTALTUNG, type LayoutGestaltung } from "./layout-schema.ts";

/*
 * Einstellungen der Beleggestaltung, die ein eigenes Layout nicht verwendet (#113). Nur der Blick in den Quelltext wie
 * bei den Pflichtfeldern: Nennt das Layout ein Feld, zählt es als verwendet, auch wenn es das Feld anders deutet. Für
 * eigene Layouts gibt Haben keine Gewähr; das Offensichtliche genügt.
 */

const OPTIONEN = Object.keys(LAYOUT_GESTALTUNG) as LayoutGestaltung[];

/** Wirken auch auf Belege, die immer das eingebaute Layout setzt (Entgeltabrechnung, Steuerbescheinigung): nie aus */
const AUCH_EINGEBAUT: ReadonlySet<LayoutGestaltung> = new Set(["accent", "logo"]);

const zurArt = (art: "beleg" | "mahnung", type: LayoutDocumentType) => (art === "mahnung") === (type === "mahnung");

/** Einstellungen, die auf diese Art wirken, deren Felder der Quelltext aber nirgends nennt */
export function ungenutzteGestaltung(source: string, art: "beleg" | "mahnung"): LayoutGestaltung[] {
  return OPTIONEN.filter((option) => {
    const { felder, belege } = LAYOUT_GESTALTUNG[option];
    return (belege as readonly LayoutDocumentType[]).some((type) => zurArt(art, type)) && !nennt(source, felder);
  });
}

/** Eigenes Layout einer Belegart mit dem, was es nicht verwendet; null = eingebautes Layout */
export type LayoutJeBeleg = Record<LayoutDocumentType, { name: string; ungenutzt: readonly LayoutGestaltung[] } | null>;

export interface GestaltungsHinweis {
  /** Kein Beleg, auf den die Einstellung wirkt, zeigt sie: deaktivieren */
  aus: boolean;
  text: string;
}

const MEHRZAHL: Record<LayoutDocumentType, string> = {
  rechnung: "Rechnungen",
  angebot: "Angebote",
  auftragsbestaetigung: "Auftragsbestätigungen",
  lieferschein: "Lieferscheine",
  mahnung: "Mahnungen",
};

const aufzaehlung = (teile: readonly string[]) => (teile.length < 2 ? (teile[0] ?? "") : `${teile.slice(0, -1).join(", ")} und ${teile.at(-1)}`);

/** „verwendet qr nicht“ bzw. „verwenden weder accent noch palette“, mit den Pfaden wie im Feldvertrag */
function verwendet(felder: string, mehrere: boolean): string {
  const pfade = felder.split("|");
  const verb = mehrere ? "verwenden" : "verwendet";
  return pfade.length === 1 ? `${verb} ${pfade[0]} nicht` : `${verb} weder ${pfade.slice(0, -1).join(", ")} noch ${pfade.at(-1)}`;
}

/**
 * Hinweis je Einstellung, die auf mindestens einem Beleg nichts ändert. Aus ist sie nur, wenn sie auf keinem Beleg mehr
 * wirkt; wirkt sie noch auf ein eingebautes oder ein anderes eigenes Layout, nennt der Hinweis die Belegarten ohne.
 */
export function gestaltungsHinweise(layouts: LayoutJeBeleg): Partial<Record<LayoutGestaltung, GestaltungsHinweis>> {
  const hinweise: Partial<Record<LayoutGestaltung, GestaltungsHinweis>> = {};
  for (const option of OPTIONEN) {
    const { felder, belege } = LAYOUT_GESTALTUNG[option];
    const ohne = (belege as readonly LayoutDocumentType[]).filter((type) => layouts[type]?.ungenutzt.includes(option));
    if (ohne.length === 0) continue;
    const namen = [...new Set(ohne.map((type) => layouts[type]!.name))];
    const satz = `${namen.length === 1 ? "Das Layout" : "Die Layouts"} ${aufzaehlung(namen.map((n) => `„${n}“`))} ${verwendet(felder, namen.length > 1)}.`;
    const aus = ohne.length === belege.length && !AUCH_EINGEBAUT.has(option);
    hinweise[option] = { aus, text: aus ? satz : `Wirkt nicht auf ${aufzaehlung(ohne.map((type) => MEHRZAHL[type]))}: ${satz}` };
  }
  return hinweise;
}
