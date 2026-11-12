import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRenderClient, type Letterhead, type RenderJob } from "@haben/einvoice";
import { env } from "../../env.ts";

/*
 * Ein Render-Prozess für alles, was Typst außerhalb der App setzt: die Vorschau der Editoren und eigene Layouts. Er
 * bekommt nichts aus der Umgebung der App und kein Netz (render-client.ts in packages/einvoice).
 */

export const layoutRenderer = createRenderClient();

/** Eigener, sonst leerer Ordner je Layout als Projektwurzel; Quelltext, Logo und Briefpapier kommen nur über den Speicher */
export async function layoutWorkspace(id: string): Promise<string> {
  const dir = join(resolve(env().DOCUMENTS_DIR), "vorlagen", id);
  await mkdir(dir, { recursive: true });
  return dir;
}

export const MAIN_FILE = "vorlage.typ";

/** Auftrag für ein eigenes Layout: Quelltext als Hauptdatei, Logo und Briefpapier unter den Namen aus den Daten */
export async function customLayoutJob(layout: { id: string; source: string }, data: object, letterhead: Letterhead): Promise<RenderJob> {
  const workspace = await layoutWorkspace(layout.id);
  const files = [
    { name: MAIN_FILE, base64: Buffer.from(layout.source, "utf8").toString("base64") },
    ...(letterhead.logo ? [{ name: `logo.${letterhead.logo.format}`, base64: Buffer.from(letterhead.logo.data).toString("base64") }] : []),
    ...(letterhead.background
      ? [{ name: `briefpapier.${letterhead.background.format}`, base64: Buffer.from(letterhead.background.data).toString("base64") }]
      : []),
  ];
  return { workspace, main: join(workspace, MAIN_FILE), data, files };
}

/** Daten für die Version des Feldvertrags, für die ein Layout geschrieben ist; heute gibt es nur Version 1 */
export function dataForVersion(version: number, data: object): object {
  if (version === 1) return data;
  throw new Error(`Für Version ${version} des Feldvertrags gibt es keinen Adapter.`);
}
