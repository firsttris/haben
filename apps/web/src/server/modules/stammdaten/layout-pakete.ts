import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderClient, packageCacheRoot, type RenderClient } from "@haben/einvoice";
import { layoutRenderer, layoutWorkspace } from "./layout-renderer.ts";

/*
 * Pakete aus @preview für eigene Layouts (#113): nur nach ausdrücklicher Freigabe, je Layout ein eigener Cache unter
 * DOCUMENTS_DIR/vorlagen/<id>/pakete (im Backup). Geladen wird einmal mit Netz und nur ein Stub, der genau die
 * freigegebenen Pakete importiert, nie der Quelltext des Layouts. Gesetzt wird immer ohne Netz, aus diesem Cache.
 */

export interface LayoutPackage {
  name: string;
  version: string;
}

export const packageSpec = ({ name, version }: LayoutPackage) => `${name}:${version}`;

export const samePackages = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();

export async function packageCache(id: string): Promise<string> {
  return join(await layoutWorkspace(id), "pakete");
}

/** Liegt jedes Paket im Cache? Nach einem Restore der Datenbank ohne das Volume fehlt er */
export async function packagesPresent(id: string, packages: readonly LayoutPackage[]): Promise<boolean> {
  const root = packageCacheRoot(await packageCache(id));
  return packages.every(({ name, version }) => {
    const [namespace, paket] = name.replace(/^@/, "").split("/") as [string, string];
    return existsSync(join(root, namespace, paket, version));
  });
}

export type PackageDownloader = (cacheDir: string, packages: readonly LayoutPackage[]) => Promise<void>;

/** Lädt die Pakete in den Cache: ein eigener Prozess mit Netz, der nur die Importe kompiliert */
export const downloadPackages: PackageDownloader = async (cacheDir, packages) => {
  const dir = await mkdtemp(join(tmpdir(), "haben-pakete-"));
  const loader = createRenderClient({ cacheDir, network: true, timeoutMs: 60_000, idleMs: 1_000 });
  try {
    const main = join(dir, "laden.typ");
    await writeFile(main, packages.map((p) => `#import "${packageSpec(p)}"`).join("\n"));
    await loader.render({ workspace: dir, main, data: {}, files: [] });
  } finally {
    loader.close();
    await rm(dir, { recursive: true, force: true });
  }
};

export async function clearPackages(id: string): Promise<void> {
  await rm(await packageCache(id), { recursive: true, force: true });
}

const renderers = new Map<string, RenderClient>();

/** Render-Prozess für ein Layout: mit Paketen ein eigener mit dessen Cache, sonst der gemeinsame */
export async function rendererFor(layout: { id: string; packages: readonly LayoutPackage[] }): Promise<RenderClient> {
  if (layout.packages.length === 0) return layoutRenderer;
  const cacheDir = await packageCache(layout.id);
  let renderer = renderers.get(cacheDir);
  if (!renderer) {
    renderer = createRenderClient({ cacheDir });
    renderers.set(cacheDir, renderer);
  }
  return renderer;
}

/** Nach dem Löschen oder Ersetzen eines Layouts: Prozess mit dessen Cache beenden */
export async function dropRenderer(id: string): Promise<void> {
  const cacheDir = await packageCache(id);
  renderers.get(cacheDir)?.close();
  renderers.delete(cacheDir);
}
