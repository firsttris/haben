import { unzipSync, type UnzipFileInfo } from "fflate";
import type { SevExportLimits } from "./types.ts";

/*
 * Entpacken mit Grenzen gegen Zip-Bomben. fflate legt für jeden Eintrag einen Puffer der Größe an, die das
 * Inhaltsverzeichnis nennt (`originalSize`), und vergrößert ihn nicht: Eine gelogene Größe kürzt die Datei, mehr
 * Speicher belegt sie nicht. Gespeicherte Einträge sind nie größer als die ZIP selbst. Deshalb reicht es, im
 * `filter` vor dem Entpacken die angegebenen Größen zu zählen. Das Budget teilen sich äußere und innere ZIPs.
 */

export const DEFAULT_LIMITS: SevExportLimits = { maxEntries: 20_000, maxUnpackedBytes: 512 * 1024 * 1024 };

export interface Budget {
  limits: SevExportLimits;
  entries: number;
  bytes: number;
}

/** `limit`: eine Grenze ist überschritten, dann bricht der ganze Export ab; sonst ist nur diese ZIP unlesbar */
export type UnzipResult = { ok: true; files: Record<string, Uint8Array> } | { ok: false; reason: string; limit: boolean };

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Entpackt die Einträge, die `wanted` auswählt; Ordner und alles andere zählen nur als Eintrag. fflate ruft `filter`
 * für jeden Eintrag auf, den das Ende der ZIP nennt (bei ZIP64 bis 2³²−1), auch ohne Daten dahinter. Deshalb bricht
 * `filter` an der Grenze mit einer Ausnahme ab, statt nur `false` zu liefern.
 */
export function unzipLimited(archive: Uint8Array, budget: Budget, wanted: (name: string) => boolean): UnzipResult {
  let exceeded: string | null = null;
  const stop = (reason: string): never => {
    exceeded = reason;
    throw new Error(reason);
  };
  const filter = (file: UnzipFileInfo) => {
    budget.entries += 1;
    if (budget.entries > budget.limits.maxEntries) stop(`Die ZIP-Datei hat mehr als ${budget.limits.maxEntries} Einträge.`);
    if (file.name.endsWith("/") || !wanted(file.name)) return false;
    budget.bytes += Math.max(file.size, file.originalSize);
    if (budget.bytes > budget.limits.maxUnpackedBytes) stop(`Die ZIP-Datei ist entpackt größer als ${megabytes(budget.limits.maxUnpackedBytes)}.`);
    return true;
  };
  try {
    return { ok: true, files: unzipSync(archive, { filter }) };
  } catch {
    if (exceeded) return { ok: false, reason: exceeded, limit: true };
    return { ok: false, reason: "Die Datei ist keine ZIP-Datei oder beschädigt.", limit: false };
  }
}

/** Dateiname ohne Ordner */
export const baseName = (path: string) => path.split("/").pop() ?? path;
