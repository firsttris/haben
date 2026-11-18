import { accentPalette, DEFAULT_ACCENT, DEFAULT_OPTIONS, LETTERHEAD_FONTS, LOGO_SIZES } from "@haben/core";
import type { Letterhead } from "./types.ts";

/*
 * Was der Briefkopf der Vorlage mitgibt (#113): Logo, Schrift, Akzentfarbe, Schalter; dazu die Gruppe jeder Zeile im Infoblock.
 */

/** Jede Zeile im Infoblock mit Gruppe (meta[].group): „kerndaten“, wo sie keine andere hat, etwa „referenz“ */
function mitGruppen(data: object): object {
  const meta = (data as { meta?: unknown }).meta;
  if (!Array.isArray(meta)) return data;
  return { ...data, meta: meta.map((zeile: { group?: string }) => ({ ...zeile, group: zeile.group ?? "kerndaten" })) };
}

/** Daten für die Vorlage mit dem Briefkopf: Akzentfarbe und passende Grautöne immer, das Logo als Dateiname neben der Vorlage */
export function templateInputs(data: object, { logo, background, accent = DEFAULT_ACCENT, options = DEFAULT_OPTIONS }: Letterhead): object {
  const size = LOGO_SIZES[options.logoSize];
  const look = {
    logoHeight: size.height,
    logoWidth: size.width,
    logoLeft: options.logoPosition === "links",
    logoPosition: options.logoPosition,
    foldMarks: options.foldMarks,
    backgroundPages: options.backgroundPages,
    options: {}, // Optionen eines eingebauten Layouts; die Vorlagen heute haben keine
  };
  const { regular, medium, semibold } = LETTERHEAD_FONTS[options.font];
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
