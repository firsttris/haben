import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PortalFirma } from "@haben/core";

/*
 * Logos der Firmen (#1036): Das Firmenportal liest sie beim Start aus PORTAL_LOGOS und liefert sie selbst aus, damit die
 * CSP bei img-src 'self' bleibt. Die Namen aus PORTAL_FIRMEN sind reine Dateinamen (parsePortalFirmen), Pfade gibt es
 * nicht. Fehlt eine Datei oder ist sie kein Bild, startet das Firmenportal trotzdem: Die Firma zeigt dann ihren
 * Anfangsbuchstaben, und die Warnung steht im Log.
 */

/** Wie in Haben (MAX_LOGO_BYTES in apps/web/src/server/modules/stammdaten/logo.ts) */
const MAX_BYTES = 1024 * 1024;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

export interface LogoDatei {
  daten: Uint8Array<ArrayBuffer>;
  typ: "image/png" | "image/jpeg";
  /** Pfad im Firmenportal mit der Prüfsumme: Ein neues Logo hat eine neue Adresse, das alte darf im Cache bleiben */
  adresse: string;
}

const beginntMit = (daten: Uint8Array, kopf: number[]) => kopf.every((byte, i) => daten[i] === byte);

/** Das Logo, wenn Inhalt und Endung zusammenpassen; sonst der Grund */
export function logoAus(datei: string, daten: Uint8Array<ArrayBuffer>): LogoDatei | { grund: string } {
  if (daten.length === 0) return { grund: "ist leer" };
  if (daten.length > MAX_BYTES) return { grund: "ist größer als 1 MB" };
  const png = datei.endsWith(".png");
  if (!beginntMit(daten, png ? PNG : JPEG)) return { grund: `ist kein ${png ? "PNG" : "JPEG"}` };
  const sha = createHash("sha256").update(daten).digest("hex").slice(0, 16);
  return { daten, typ: png ? "image/png" : "image/jpeg", adresse: `/zeichen/${sha}.${png ? "png" : "jpg"}` };
}

/** Alle Logos aus PORTAL_FIRMEN, nach Dateiname; ohne Verzeichnis keine */
export async function ladeLogos(
  verzeichnis: string | undefined,
  firmen: readonly PortalFirma[],
  warnen: (text: string) => void,
): Promise<Map<string, LogoDatei>> {
  const logos = new Map<string, LogoDatei>();
  if (!verzeichnis) return logos;
  for (const firma of firmen) {
    if (!firma.logo || logos.has(firma.logo)) continue;
    const daten = await readFile(join(verzeichnis, firma.logo)).catch(() => null);
    const logo = daten ? logoAus(firma.logo, new Uint8Array(daten)) : { grund: "fehlt" };
    if ("grund" in logo) warnen(`Firmenportal: Logo „${firma.logo}“ für „${firma.name}“ ${logo.grund}; die Firma zeigt ihren Anfangsbuchstaben.`);
    else logos.set(firma.logo, logo);
  }
  return logos;
}
