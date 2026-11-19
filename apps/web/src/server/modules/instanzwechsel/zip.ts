import { strToU8, type UnzipFileInfo, unzipSync, type Zippable, zipSync } from "fflate";
import { EINSTELLUNGEN_JSON, istEinstellungenJson } from "../../../lib/einstellungsdatei.ts";
import { UserError } from "../../errors.ts";

/*
 * Das ZIP der Einstellungsdatei (#488): `einstellungen.json` mit den Daten, daneben Logo, Briefpapier und Standardanhänge
 * als Dateien, wie sie gespeichert sind. Bilder und PDFs sind schon komprimiert und gehen ungepackt hinein.
 */

export const SETTINGS_JSON = EINSTELLUNGEN_JSON;

export class SettingsFileError extends UserError {}

export function settingsZip(datei: object, dateien: Readonly<Record<string, Uint8Array>>, mtime: Date): Uint8Array {
  const zippable: Zippable = { [SETTINGS_JSON]: [strToU8(JSON.stringify(datei, null, 2)), { level: 6, mtime }] };
  for (const [pfad, bytes] of Object.entries(dateien)) {
    // Verschachtelt statt „ordner/datei“ als Schlüssel: So legt fflate die Ordner im ZIP an
    const teile = pfad.split("/");
    const name = teile.pop() ?? pfad;
    let ordner = zippable;
    for (const teil of teile) {
      ordner[teil] ??= {};
      ordner = ordner[teil] as Zippable;
    }
    ordner[name] = [bytes, { level: 0, mtime }];
  }
  return zipSync(zippable);
}

export interface ZipLimits {
  maxEntries: number;
  maxUnpackedBytes: number;
}

/**
 * Entpacken mit Grenzen gegen Zip-Bomben, wie beim sevDesk-Export (`unzipLimited` in packages/import): fflate legt je
 * Eintrag einen Puffer der Größe aus dem Inhaltsverzeichnis an und vergrößert ihn nicht, deshalb reicht es, diese
 * Größen im `filter` vor dem Entpacken zu zählen. `filter` bricht an der Grenze mit einer Ausnahme ab, weil fflate ihn
 * auch für Einträge ohne Daten dahinter aufruft.
 */
export function unzipSettings(archive: Uint8Array, limits: ZipLimits): Record<string, Uint8Array> {
  let grenze: string | null = null;
  let entries = 0;
  let bytes = 0;
  const filter = (file: UnzipFileInfo) => {
    const ohneDaten = file.name.endsWith("/") || macosMetadaten(file.name);
    entries += 1;
    if (!ohneDaten) bytes += Math.max(file.size, file.originalSize);
    if (entries > limits.maxEntries) grenze = `Das ZIP hat mehr als ${limits.maxEntries} Einträge; eine Einstellungsdatei hat weniger.`;
    else if (bytes > limits.maxUnpackedBytes) grenze = "Das ZIP ist entpackt größer, als eine Einstellungsdatei sein kann.";
    if (grenze) throw new Error(grenze);
    return !ohneDaten;
  };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive, { filter });
  } catch {
    throw new SettingsFileError(grenze ?? "Die Datei ist keine ZIP-Datei oder beschädigt. Erwartet wird das ZIP aus „Einstellungen exportieren“.");
  }
  return abDerJson(files);
}

/** Was der Finder beim Packen dazulegt (erweiterte Attribute unter __MACOSX/ und als ._Datei), gehört nicht zur Datei */
const macosMetadaten = (name: string) => name.startsWith("__MACOSX/") || name.split("/").some((teil) => teil.startsWith("._"));

/** Pfade ab dem Ordner der JSON, wenn jemand das entpackte ZIP samt Ordner wieder gepackt hat (istEinstellungenJson) */
function abDerJson(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const json = Object.keys(files).filter(istEinstellungenJson);
  if (json.length !== 1 || json[0] === SETTINGS_JSON) return files;
  const ordner = json[0]!.slice(0, -SETTINGS_JSON.length);
  return Object.fromEntries(Object.entries(files).flatMap(([name, bytes]) => (name.startsWith(ordner) ? [[name.slice(ordner.length), bytes] as const] : [])));
}
