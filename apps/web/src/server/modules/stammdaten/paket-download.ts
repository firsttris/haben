import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { packageCacheRoot } from "@haben/einvoice";
import { LayoutError, packagesIn } from "./layout-pruefung.ts";
import { type TarFile, TarError, untarGz } from "./tar-entpacken.ts";

/*
 * Pakete aus Typst Universe für eigene Layouts (#113). Haben lädt die Archive selbst statt Typst, damit Grenzen gelten:
 * gepackt und entpackt je Paket, Zahl der Dateien, Zahl der Pakete samt Abhängigkeiten und Größe aller zusammen. Die
 * Abhängigkeiten stehen nur in den Importen der .typ-Dateien eines Pakets; Haben sucht sie dort, bevor gefragt wird, damit
 * die Rückfrage alle Pakete nennt. Geschrieben wird erst nach der Freigabe, in den Cache des Layouts; Typst setzt danach
 * ohne Netz aus diesem Cache.
 */

export interface LayoutPackage {
  name: string;
  version: string;
}

export interface ResolvedPackage extends LayoutPackage {
  files: TarFile[];
  bytes: number;
}

/** Holt das Archiv eines Pakets; austauschbar für Tests */
export type PackageFetcher = (pkg: LayoutPackage, maxBytes: number) => Promise<Uint8Array>;

export const PACKAGE_LIMITS = {
  /** gepackt je Paket; cetz 0.3.4 hat 77 KB */
  maxArchiveBytes: 5 * 1024 * 1024,
  /** entpackt je Paket */
  maxUnpackedBytes: 20 * 1024 * 1024,
  maxFiles: 1000,
  /** Pakete samt Abhängigkeiten je Layout */
  maxPackages: 20,
  /** entpackt alle Pakete eines Layouts zusammen */
  maxTotalBytes: 50 * 1024 * 1024,
  timeoutMs: 30_000,
};

export const UNIVERSE = "https://packages.typst.org/preview";

export const packageSpec = ({ name, version }: LayoutPackage) => `${name}:${version}`;

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Lädt Archive aus Typst Universe oder einem Spiegel (LAYOUTS_PACKAGES_URL, darunter je Paket <name>-<version>.tar.gz) und
 * bricht ab, sobald eines größer wird als erlaubt
 */
export const universeFetcher =
  (baseUrl: string = UNIVERSE): PackageFetcher =>
  async (pkg, maxBytes) => {
    const url = `${baseUrl.replace(/\/+$/, "")}/${pkg.name.replace(/^@preview\//, "")}-${pkg.version}.tar.gz`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(PACKAGE_LIMITS.timeoutMs), redirect: "error" });
    } catch {
      throw new LayoutError(`Typst Universe war für ${packageSpec(pkg)} nicht erreichbar.`);
    }
    if (response.status === 404) throw new LayoutError(`Das Paket ${packageSpec(pkg)} gibt es in Typst Universe nicht.`);
    if (!response.ok || !response.body) throw new LayoutError(`Typst Universe antwortete für ${packageSpec(pkg)} mit ${response.status}.`);
    const tooBig = () => new LayoutError(`Das Paket ${packageSpec(pkg)} ist gepackt größer als ${megabytes(maxBytes)}.`);
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw tooBig();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw tooBig();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  };

const tomlValue = (toml: string, key: string) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml)?.[1];

/** Entpackt ein Paket und prüft, dass es das verlangte ist */
function unpack(pkg: LayoutPackage, archive: Uint8Array): ResolvedPackage {
  let files: TarFile[];
  try {
    files = untarGz(archive, { maxUnpackedBytes: PACKAGE_LIMITS.maxUnpackedBytes, maxFiles: PACKAGE_LIMITS.maxFiles });
  } catch (error) {
    if (error instanceof TarError) throw new LayoutError(`${packageSpec(pkg)}: ${error.message}`);
    throw error;
  }
  const toml = files.find((f) => f.path === "typst.toml")?.data.toString("utf8") ?? "";
  if (`@preview/${tomlValue(toml, "name")}` !== pkg.name || tomlValue(toml, "version") !== pkg.version) {
    throw new LayoutError(`Das Archiv von ${packageSpec(pkg)} enthält ein anderes Paket.`);
  }
  return { ...pkg, files, bytes: files.reduce((sum, f) => sum + f.data.length, 0) };
}

/** Importe anderer Pakete in den .typ-Dateien eines Pakets */
const dependenciesOf = (pkg: ResolvedPackage) =>
  packagesIn(
    pkg.files
      .filter((f) => f.path.endsWith(".typ"))
      .map((f) => f.data.toString("utf8"))
      .join("\n"),
  ).filter((dep) => packageSpec(dep) !== packageSpec(pkg));

/**
 * Lädt die Pakete eines Layouts samt allen Abhängigkeiten in den Speicher, nichts auf die Platte. Nur @preview; jedes
 * Paket einmal, in der Reihenfolge des Findens.
 */
export async function resolvePackages(roots: readonly LayoutPackage[], fetcher: PackageFetcher): Promise<ResolvedPackage[]> {
  const queue = [...roots];
  const seen = new Set<string>();
  const resolved: ResolvedPackage[] = [];
  let total = 0;
  while (queue.length > 0) {
    const pkg = queue.shift()!;
    const spec = packageSpec(pkg);
    if (seen.has(spec)) continue;
    seen.add(spec);
    if (!pkg.name.startsWith("@preview/")) throw new LayoutError(`Nur Pakete aus @preview (Typst Universe) sind möglich, nicht ${spec}.`);
    if (seen.size > PACKAGE_LIMITS.maxPackages) throw new LayoutError(`Das Layout braucht samt Abhängigkeiten mehr als ${PACKAGE_LIMITS.maxPackages} Pakete.`);
    const unpacked = unpack(pkg, await fetcher(pkg, PACKAGE_LIMITS.maxArchiveBytes));
    total += unpacked.bytes;
    if (total > PACKAGE_LIMITS.maxTotalBytes)
      throw new LayoutError(`Die Pakete des Layouts sind entpackt größer als ${megabytes(PACKAGE_LIMITS.maxTotalBytes)}.`);
    resolved.push(unpacked);
    queue.push(...dependenciesOf(unpacked));
  }
  return resolved;
}

/** Schreibt geladene Pakete dorthin, wo Typst sie ohne Netz sucht */
export async function writePackages(cacheDir: string, packages: readonly ResolvedPackage[]): Promise<void> {
  const root = packageCacheRoot(cacheDir);
  for (const pkg of packages) {
    const dir = join(root, "preview", pkg.name.replace(/^@preview\//, ""), pkg.version);
    for (const file of pkg.files) {
      const path = join(dir, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.data);
    }
  }
}
