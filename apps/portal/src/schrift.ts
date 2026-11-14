import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

/*
 * IBM Plex Sans wie in Haben, vom Portal selbst ausgeliefert (keine fremde Quelle, CSP font-src 'self'). Nur der
 * lateinische Ausschnitt: Er enthält Umlaute und ß. Im Image liegen die Dateien in PORTAL_SCHRIFTEN
 * (apps/portal/Containerfile), sonst kommen sie aus @fontsource/ibm-plex-sans.
 */

export const GEWICHTE = [400, 500, 600] as const;

const datei = (gewicht: number) => {
  const name = `ibm-plex-sans-latin-${gewicht}-normal.woff2`;
  const verzeichnis = process.env.PORTAL_SCHRIFTEN;
  return verzeichnis ? join(verzeichnis, name) : createRequire(import.meta.url).resolve(`@fontsource/ibm-plex-sans/files/${name}`);
};

const cache = new Map<number, Promise<ArrayBuffer | null>>();

/** Die Schrift für /schrift/plex-<gewicht>.woff2, null ohne Datei (dann nimmt der Browser system-ui) */
export function schrift(pfad: string): Promise<ArrayBuffer | null> | null {
  const gewicht = GEWICHTE.find((g) => pfad === `/schrift/plex-${g}.woff2`);
  if (!gewicht) return null;
  let geladen = cache.get(gewicht);
  if (!geladen) {
    geladen = readFile(datei(gewicht)).then(
      (inhalt) => inhalt.buffer.slice(inhalt.byteOffset, inhalt.byteOffset + inhalt.byteLength) as ArrayBuffer,
      () => null,
    );
    cache.set(gewicht, geladen);
  }
  return geladen;
}
