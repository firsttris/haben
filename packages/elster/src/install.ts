/**
 * ERiC beim Betreiber installieren: Haben liefert die Bibliothek nicht mit (Lizenz der
 * Finanzverwaltung), lädt sie aber auf Wunsch direkt von download.elster.de herunter und entpackt
 * nur den Teil für Linux x86_64.
 */
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { type FileHandle, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";
import { ericLibraryPath, ericPluginPath } from "./eric.ts";

/** Zuletzt bekannte ERiC-Version; neuere stehen im Entwicklerbereich von ELSTER */
export const DEFAULT_ERIC_VERSION = "43.4.6.0";
export const ERIC_DOWNLOAD_BASE = "https://download.elster.de/download/eric";
/** Infoseite mit der aktuellen Version und den Nutzungsbedingungen */
export const ERIC_INFO_URL = "https://www.elster.de/elsterweb/entwickler/infoseite/eric";
export const ERIC_PLATFORM = "Linux-x86_64";

const VERSION_FILE = "HABEN_ERIC_VERSION";
/** Im Zielverzeichnis: Name des Unterordners mit der aktiven Version */
const CURRENT_FILE = "AKTUELL";

export class EricInstallError extends Error {}

export function isEricVersion(version: string): boolean {
  return /^\d{2,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version);
}

export function ericDownloadUrl(version: string, base = ERIC_DOWNLOAD_BASE): string {
  if (!isEricVersion(version)) throw new EricInstallError(`Ungültige ERiC-Version: ${version}`);
  return `${base.replace(/\/+$/, "")}/eric_${version.split(".")[0]}/ERiC-${version}-${ERIC_PLATFORM}.jar`;
}

/** Liegt unter dir ein vollständiges ERiC (Bibliothek und Plugins)? */
export function isEricInstalled(dir: string): boolean {
  return existsSync(ericLibraryPath(dir)) && existsSync(ericPluginPath(dir));
}

/**
 * ERIC_HOME innerhalb des Download-Verzeichnisses: der Unterordner der aktiven Version, oder das
 * Verzeichnis selbst, wenn ERiC dort von Hand entpackt wurde; sonst null.
 */
export function ericHomeIn(dir: string): string | null {
  try {
    const name = readFileSync(join(dir, CURRENT_FILE), "utf8").trim();
    if (/^ERiC-[\d.]+(-2)?$/.test(name) && isEricInstalled(join(dir, name))) return join(dir, name);
  } catch {
    // keine Zeigerdatei
  }
  return isEricInstalled(dir) ? dir : null;
}

/** Von Haben installierte Version unter ERIC_HOME, sonst null (z. B. von Hand entpackt) */
export async function installedEricVersion(dir: string): Promise<string | null> {
  try {
    return (await readFile(join(dir, VERSION_FILE), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export interface InstallProgress {
  phase: "download" | "entpacken" | "fertig";
  /** Heruntergeladene bzw. gelesene Bytes und Gesamtgröße, falls bekannt */
  bytes: number;
  total: number | null;
}

export interface InstallOptions {
  version: string;
  /** Download-Verzeichnis (ERIC_DIR); ERIC_HOME ist danach ericHomeIn(dir) */
  dir: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  onProgress?: (progress: InstallProgress) => void;
  /** Nur Linux x86_64; in Tests abschaltbar */
  checkPlatform?: boolean;
}

/**
 * Lädt das ERiC-Paket, entpackt alle Dateien unter `…/Linux-x86_64/` nach dir und ersetzt eine
 * vorhandene Installation erst, wenn die neue vollständig ist.
 */
export async function installEric(options: InstallOptions): Promise<{ version: string; files: number }> {
  if ((options.checkPlatform ?? true) && (process.platform !== "linux" || process.arch !== "x64")) {
    throw new EricInstallError(`ERiC gibt es für Server nur für Linux x86_64, nicht für ${process.platform}/${process.arch}.`);
  }
  const url = ericDownloadUrl(options.version, options.baseUrl);
  const work = await mkdtemp(join(tmpdir(), "haben-ericdl-"));
  try {
    const jar = join(work, "eric.jar");
    await download(url, jar, options);

    // Das Ziel ist im Container ein Volume und lässt sich nicht umbenennen: Versionen liegen in
    // Unterordnern, AKTUELL zeigt auf die aktive; umgeschaltet wird erst nach vollständigem Entpacken.
    const root = normalize(options.dir).replace(/\/+$/, "");
    await mkdir(root, { recursive: true });
    const name = `ERiC-${options.version}`;
    const fresh = join(root, `${name}.neu`);
    await rm(fresh, { recursive: true, force: true });
    let files: number;
    try {
      files = await extractPlatform(jar, fresh, options.onProgress);
      if (!isEricInstalled(fresh)) throw new EricInstallError(`Im Paket fehlt lib/libericapi.so oder lib/plugins für ${ERIC_PLATFORM}.`);
      await writeFile(join(fresh, VERSION_FILE), `${options.version}\n`);
    } catch (error) {
      await rm(fresh, { recursive: true, force: true });
      throw error;
    }

    // Dieselbe Version noch einmal: neben die laufende legen, damit AKTUELL nie ins Leere zeigt
    const active = ericHomeIn(root);
    const target = [name, `${name}-2`].map((n) => join(root, n)).find((path) => path !== active)!;
    await rm(target, { recursive: true, force: true });
    await rename(fresh, target);
    const pointer = join(root, `${CURRENT_FILE}.neu`);
    await writeFile(pointer, `${basename(target)}\n`);
    await rename(pointer, join(root, CURRENT_FILE));
    // Alte Versionen aufräumen; laufende Prüfungen haben ihre Bibliothek schon geladen
    for (const entry of await readdir(root)) {
      if (entry.startsWith("ERiC-") && entry !== basename(target)) await rm(join(root, entry), { recursive: true, force: true });
    }
    options.onProgress?.({ phase: "fertig", bytes: 0, total: null });
    return { version: options.version, files };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function download(url: string, path: string, options: InstallOptions) {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url);
  } catch (cause) {
    throw new EricInstallError(`download.elster.de nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (response.status === 404) {
    throw new EricInstallError(`ERiC ${options.version} gibt es nicht (mehr) zum Download. Die aktuelle Version steht auf ${ERIC_INFO_URL}.`);
  }
  if (!response.ok || !response.body) throw new EricInstallError(`Download fehlgeschlagen: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || null;
  let bytes = 0;
  let last = 0;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    // Fortschritt höchstens je Megabyte melden
    if (bytes - last >= 1 << 20) {
      last = bytes;
      options.onProgress?.({ phase: "download", bytes, total });
    }
  });
  await pipeline(body, createWriteStream(path));
}

interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const invalidZip = () => new EricInstallError("Das ERiC-Paket ist beschädigt oder kein ZIP-Archiv.");

/**
 * Liest das Inhaltsverzeichnis am Ende des Archivs. Das ERiC-Paket ist ein Java-JAR mit nachgestellten
 * Größenangaben (Datendeskriptor); ein Streaming-Entpacker muss dort das Ende eines Eintrags raten und
 * scheitert z. B. an eingebetteten JARs. Hier stehen Größe, Prüfsumme und Position jedes Eintrags fest.
 */
async function zipEntries(file: FileHandle, fileSize: number): Promise<ZipEntry[]> {
  // End of Central Directory: 22 Byte plus höchstens 64 KB Kommentar
  const tail = Buffer.alloc(Math.min(fileSize, 22 + 0xffff));
  await file.read(tail, 0, tail.length, fileSize - tail.length);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > tail.length) throw invalidZip();
  const count = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64 braucht ERiC nicht (unter 4 GB, unter 65.535 Einträge)
  if (count === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > fileSize) throw invalidZip();
  const directory = Buffer.alloc(directorySize);
  await file.read(directory, 0, directorySize, directoryOffset);

  const entries: ZipEntry[] = [];
  let pos = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > directory.length || directory.readUInt32LE(pos) !== 0x02014b50) throw invalidZip();
    const nameLength = directory.readUInt16LE(pos + 28);
    entries.push({
      method: directory.readUInt16LE(pos + 10),
      crc: directory.readUInt32LE(pos + 16),
      compressedSize: directory.readUInt32LE(pos + 20),
      size: directory.readUInt32LE(pos + 24),
      localOffset: directory.readUInt32LE(pos + 42),
      name: directory.toString("utf8", pos + 46, pos + 46 + nameLength),
    });
    pos += 46 + nameLength + directory.readUInt16LE(pos + 30) + directory.readUInt16LE(pos + 32);
  }
  return entries;
}

/** Entpackt einen Eintrag (gespeichert oder Deflate) und prüft Größe und CRC-32 */
async function extractEntry(jar: string, file: FileHandle, entry: ZipEntry, path: string): Promise<void> {
  const header = Buffer.alloc(30);
  await file.read(header, 0, 30, entry.localOffset);
  if (header.readUInt32LE(0) !== 0x04034b50) throw invalidZip();
  const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.method !== 0 && entry.method !== 8) throw new EricInstallError(`Nicht unterstützte Kompression im ERiC-Paket: ${entry.name}`);

  let crc = 0;
  let size = 0;
  async function* check(chunks: AsyncIterable<Buffer>) {
    for await (const chunk of chunks) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      yield chunk;
    }
  }
  // createReadStream mit end < start liefert nichts; leere Dateien brauchen das
  const source = createReadStream(jar, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 8) await pipeline(source, createInflateRaw(), check, createWriteStream(path));
  else await pipeline(source, check, createWriteStream(path));
  if (size !== entry.size || crc >>> 0 !== entry.crc) throw new EricInstallError(`Beschädigter Eintrag im ERiC-Paket: ${entry.name}`);
}

/** Entpackt die Einträge unter `<irgendwas>/Linux-x86_64/` ohne dieses Präfix; liefert die Anzahl Dateien */
async function extractPlatform(jar: string, target: string, onProgress?: (p: InstallProgress) => void): Promise<number> {
  const marker = `/${ERIC_PLATFORM}/`;
  const file = await open(jar, "r");
  try {
    const wanted = (await zipEntries(file, (await file.stat()).size)).flatMap((entry) => {
      const index = `/${entry.name}`.indexOf(marker);
      if (index < 0 || entry.name.endsWith("/")) return [];
      const path = normalize(join(target, `/${entry.name}`.slice(index + marker.length)));
      // Keine Pfade außerhalb des Ziels (../ im Archiv)
      if (!path.startsWith(`${target}/`)) throw new EricInstallError(`Unzulässiger Pfad im Archiv: ${entry.name}`);
      return [{ entry, path }];
    });
    if (wanted.length === 0) throw new EricInstallError(`Das Paket enthält keine Dateien für ${ERIC_PLATFORM}.`);

    const total = wanted.reduce((sum, { entry }) => sum + entry.compressedSize, 0);
    let bytes = 0;
    for (const { entry, path } of wanted) {
      await mkdir(dirname(path), { recursive: true });
      await extractEntry(jar, file, entry, path);
      bytes += entry.compressedSize;
      onProgress?.({ phase: "entpacken", bytes, total });
    }
    return wanted.length;
  } finally {
    await file.close();
  }
}
