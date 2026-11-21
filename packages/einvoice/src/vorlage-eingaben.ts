import {
  accentPalette,
  DEFAULT_ACCENT,
  DEFAULT_OPTIONS,
  eingebautesLayout,
  LETTERHEAD_FONTS,
  LOGO_SIZES,
  layoutOptionen,
  layoutVorgaben,
  layoutVorlagen,
  logoStelle,
  STANDARD_LAYOUT_ID,
} from "@haben/core";
import type { Letterhead } from "./types.ts";

/*
 * Was der Briefkopf der Vorlage mitgibt (#113): eingebautes Layout mit Optionen, Logo, Schrift und Akzentfarbe; dazu die
 * Gruppe jeder Zeile im Infoblock.
 */

/** Jede Zeile im Infoblock mit Gruppe (meta[].group): „kerndaten“, wo sie keine andere hat, etwa „referenz“ */
function mitGruppen(data: object): object {
  const meta = (data as { meta?: unknown }).meta;
  if (!Array.isArray(meta)) return data;
  return { ...data, meta: meta.map((zeile: { group?: string }) => ({ ...zeile, group: zeile.group ?? "kerndaten" })) };
}

/** Eingebautes Layout eines Briefkopfs mit aufgelösten Optionen; ohne Angabe oder unbekannt (etwa „klassisch“ von vor 0312) Klar in der Fassung „Klassisch“ */
function katalogLayout(letterhead: Letterhead) {
  const gewaehlt = letterhead.layout ? eingebautesLayout(letterhead.layout.id) : undefined;
  const layout = gewaehlt ?? eingebautesLayout(STANDARD_LAYOUT_ID);
  if (!layout) throw new Error("Das Standardlayout fehlt im Katalog der Layouts.");
  return { layout, optionen: layoutOptionen(layout, gewaehlt ? letterhead.layout?.optionen : { fassung: "klassisch" }) };
}

/** Vorlage für Beleg oder Mahnung nach Layout und Optionen; die Fassung „Klassisch“ von Klar bleibt rechnung.typ und mahnung.typ */
export function layoutTemplate(art: "beleg" | "mahnung", letterhead: Letterhead): string {
  const { layout, optionen } = katalogLayout(letterhead);
  return layoutVorlagen(layout, optionen)[art];
}

/** Daten für die Vorlage mit dem Briefkopf: Akzentfarbe und passende Grautöne immer, das Logo als Dateiname neben der Vorlage */
export function templateInputs(data: object, letterhead: Letterhead): object {
  const { logo, background, options = DEFAULT_OPTIONS } = letterhead;
  const { layout, optionen } = katalogLayout(letterhead);
  const size = LOGO_SIZES[options.logoSize];
  const stelle = logoStelle(layout, optionen, options.logoPosition);
  const look = {
    logoHeight: size.height,
    logoWidth: size.width,
    logoLeft: stelle === "links",
    logoPosition: stelle,
    foldMarks: options.foldMarks,
    backgroundPages: options.backgroundPages,
    // Feldvertrag: leer bei eigenen Layouts; die tragen kein eingebautes Layout im Briefkopf (withCustomLayout)
    options: letterhead.layout ? optionen : {},
  };
  // „Wie im Layout“: Schrift und Akzentfarbe aus den Vorgaben des Layouts, eine eigene Wahl gilt immer
  const vorgaben = layoutVorgaben(layout, optionen);
  const font = options.font === "layout" ? vorgaben.font : options.font;
  const accent = letterhead.options?.accentFromLayout ? vorgaben.accent : (letterhead.accent ?? DEFAULT_ACCENT);
  const { regular, medium, semibold } = LETTERHEAD_FONTS[font];
  return {
    ...mitGruppen(data),
    accent,
    palette: accentPalette(accent),
    look,
    font: { regular, medium, semibold },
    ...(logo ? { logo: `logo.${logo.format}` } : {}),
    ...(background ? { background: `briefpapier.${background.format}` } : {}),
  };
}
