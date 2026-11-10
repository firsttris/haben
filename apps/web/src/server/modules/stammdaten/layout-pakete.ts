import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRenderClient, packageCacheRoot, type RenderClient } from "@haben/einvoice";
import { layoutRenderer, layoutWorkspace } from "./layout-renderer.ts";
import type { LayoutPackage } from "./paket-download.ts";

/*
 * Paket-Cache eigener Layouts (#113): nur nach ausdrücklicher Freigabe, je Layout ein eigener unter
 * DOCUMENTS_DIR/vorlagen/<id>/pakete (im Backup). Laden: paket-download.ts. Gesetzt wird immer ohne Netz, aus diesem Cache.
 */

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

/** Belegter Platz unter einem Ordner in Byte, etwa der Paket-Cache eines Layouts */
export async function directorySize(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : entry.isFile() ? (await stat(path)).size : 0;
  }
  return total;
}
