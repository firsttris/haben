import { gunzipSync } from "node:zlib";

/*
 * Entpackt ein Typst-Paket (.tar.gz) im Speicher, mit Grenzen gegen Archivbomben (#113): Die entpackte Größe begrenzt
 * schon gunzip (maxOutputLength), dazu die Zahl der Dateien. Nur Dateien und Ordner; Links, Geräte und Pfade, die aus dem
 * Paket hinausführen, lehnt es ab. Gelesen werden ustar, GNU-Langnamen (L) und PAX-Pfade (x).
 */

export interface TarLimits {
  maxUnpackedBytes: number;
  maxFiles: number;
}

export interface TarFile {
  path: string;
  data: Buffer;
}

export class TarError extends Error {}

const text = (block: Buffer, start: number, length: number) =>
  block
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "");

function octal(block: Buffer, start: number, length: number): number {
  const value = text(block, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new TarError("Das Archiv ist beschädigt.");
  return value ? Number.parseInt(value, 8) : 0;
}

/** Relativer Pfad ohne „./“; null für die Wurzel. Absolute Pfade und „..“ führen aus dem Paket hinaus */
export function safePath(raw: string): string | null {
  const parts = raw
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (raw.startsWith("/") || parts.includes("..")) throw new TarError(`Das Archiv enthält einen Pfad außerhalb des Pakets: ${raw}`);
  return parts.length > 0 ? parts.join("/") : null;
}

function paxPath(data: Buffer): string | undefined {
  // Einträge „<Länge> schlüssel=wert\n“
  for (const line of data.toString("utf8").split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export function untarGz(archive: Uint8Array, limits: TarLimits): TarFile[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: limits.maxUnpackedBytes });
  } catch (error) {
    if (error instanceof RangeError) throw new TarError(`Das Paket ist entpackt größer als ${Math.round(limits.maxUnpackedBytes / 1024 / 1024)} MB.`);
    throw new TarError("Das Archiv ist kein gültiges .tar.gz.");
  }
  const files: TarFile[] = [];
  let nextName: string | undefined;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156]!) || "0";
    const start = at + 512;
    const data = tar.subarray(start, start + size);
    if (data.length < size) throw new TarError("Das Archiv ist unvollständig.");
    at = start + Math.ceil(size / 512) * 512;
    const prefix = text(header, 257, 6).startsWith("ustar") ? text(header, 345, 155) : "";
    const name = nextName ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    nextName = undefined;
    if (type === "L") nextName = data.toString("utf8").replace(/\0.*$/s, "");
    else if (type === "x") nextName = paxPath(data);
    else if (type === "g" || type === "5") safePath(name);
    else if (type === "0" || type === "\0" || type === "7") {
      const path = safePath(name);
      if (!path) throw new TarError("Das Archiv enthält eine Datei ohne Namen.");
      files.push({ path, data: Buffer.from(data) });
      if (files.length > limits.maxFiles) throw new TarError(`Das Paket hat mehr als ${limits.maxFiles} Dateien.`);
    } else throw new TarError(`Das Archiv enthält einen Eintrag, der keine Datei ist (Art ${JSON.stringify(type)}): ${name}`);
  }
  return files;
}
