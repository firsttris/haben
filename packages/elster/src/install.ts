/**
 * ERiC beim Betreiber installieren: Haben liefert die Bibliothek nicht mit (Lizenz der
 * Finanzverwaltung), lädt sie aber auf Wunsch direkt von download.elster.de herunter und entpackt
 * nur den Teil für Linux x86_64.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, type WriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
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
    if (/^ERiC-[\d.]+$/.test(name) && isEricInstalled(join(dir, name))) return join(dir, name);
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
  const work = await mkdtemp(join(tmpdir(), "haben-eric-"));
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
    const files = await extractPlatform(jar, fresh, options.onProgress);
    if (!isEricInstalled(fresh)) {
      await rm(fresh, { recursive: true, force: true });
      throw new EricInstallError(`Im Paket fehlt lib/libericapi.so oder lib/plugins2 für ${ERIC_PLATFORM}.`);
    }
    await writeFile(join(fresh, VERSION_FILE), `${options.version}\n`);

    const target = join(root, name);
    const active = ericHomeIn(root);
    // Dieselbe Version noch einmal: die laufende bleibt bis zum Umschalten unter anderem Namen erhalten
    const previous = active === target ? join(root, `${name}.alt`) : active;
    if (active === target) {
      await rm(previous!, { recursive: true, force: true });
      await rename(target, previous!);
    } else {
      await rm(target, { recursive: true, force: true });
    }
    await rename(fresh, target);
    const pointer = join(root, `${CURRENT_FILE}.neu`);
    await writeFile(pointer, `${name}\n`);
    await rename(pointer, join(root, CURRENT_FILE));
    // Alte Versionen aufräumen; laufende Prüfungen haben ihre Bibliothek schon geladen
    for (const entry of await readdir(root)) {
      if (entry.startsWith("ERiC-") && entry !== name) await rm(join(root, entry), { recursive: true, force: true });
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

/** Entpackt die Einträge unter `<irgendwas>/Linux-x86_64/` ohne dieses Präfix; liefert die Anzahl Dateien */
async function extractPlatform(jar: string, target: string, onProgress?: (p: InstallProgress) => void): Promise<number> {
  const marker = `/${ERIC_PLATFORM}/`;
  const writes: Promise<void>[] = [];
  let files = 0;
  let failure: unknown = null;
  const open = new Set<WriteStream>();

  const unzip = new Unzip((file: UnzipFile) => {
    const index = `/${file.name}`.indexOf(marker);
    if (index < 0 || file.name.endsWith("/")) return;
    const relative = `/${file.name}`.slice(index + marker.length);
    const path = normalize(join(target, relative));
    // Keine Pfade außerhalb des Ziels (../ im Archiv)
    if (!path.startsWith(`${target}/`)) {
      failure = new EricInstallError(`Unzulässiger Pfad im Archiv: ${file.name}`);
      return;
    }
    files++;
    // Synchron anmelden: fflate überspringt Dateien, für die start() nicht sofort aufgerufen wird
    mkdirSync(dirname(path), { recursive: true });
    const out = createWriteStream(path);
    open.add(out);
    out.on("close", () => open.delete(out));
    writes.push(
      new Promise<void>((resolve, reject) => {
        out.on("error", reject);
        out.on("finish", resolve);
      }),
    );
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = error;
        out.destroy(error);
        return;
      }
      out.write(chunk);
      if (final) out.end();
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  let bytes = 0;
  for await (const chunk of createReadStream(jar, { highWaterMark: 1 << 20 })) {
    unzip.push(chunk as Uint8Array);
    bytes += (chunk as Buffer).length;
    onProgress?.({ phase: "entpacken", bytes, total: null });
    if (failure) throw failure;
    // Nicht schneller lesen als geschrieben wird
    for (const out of open) if (out.writableNeedDrain) await once(out, "drain");
  }
  unzip.push(new Uint8Array(0), true);
  await Promise.all(writes);
  if (failure) throw failure;
  if (files === 0) throw new EricInstallError(`Das Paket enthält keine Dateien für ${ERIC_PLATFORM}.`);
  return files;
}
