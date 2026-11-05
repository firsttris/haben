/*
 * Inhalt von normen.json, wie `--normen-schreiben` ihn schreibt. Biome formatiert JSON anders als JSON.stringify
 * (kurze Arrays in einer Zeile, Zeilenbreite aus biome.json); deshalb formatiert Biome selbst, sonst schlüge
 * `bun run lint` nach jedem Schreiben fehl.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Norm } from "./normen.ts";

const WURZEL = join(import.meta.dirname, "../..");
const BIOME = join(WURZEL, "node_modules/@biomejs/biome/bin/biome");
/** Pfad, unter dem Biome den Text formatiert: entscheidet über Sprache und Einstellungen aus biome.json */
const PFAD_IM_REPO = "scripts/jahreswerte/normen.json";

export function normenDatei(normen: readonly Norm[]): string {
  const biome = spawnSync(process.execPath, [BIOME, "format", `--stdin-file-path=${PFAD_IM_REPO}`], {
    cwd: WURZEL,
    input: JSON.stringify({ normen }),
    encoding: "utf8",
  });
  if (biome.status !== 0) throw new Error(`Biome konnte normen.json nicht formatieren: ${biome.stderr}`);
  return biome.stdout;
}
