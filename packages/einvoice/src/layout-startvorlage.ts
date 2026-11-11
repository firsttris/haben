import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_DIR } from "./typst-compiler.ts";

/*
 * Startvorlage für eigene Layouts: die eingebaute Vorlage als eine Datei. Ein eigenes Layout liest nichts außerhalb seines
 * Ordners, darum steht entwurf.typ (Vermerk und Platzhalter des GiroCodes) mit darin statt als Import.
 */

const IMPORT = /^#import "entwurf\.typ": entwurf-vermerk, girocode-feld\n/m;

export function startvorlage(art: "beleg" | "mahnung"): string {
  const dir = join(PACKAGE_DIR, "templates");
  const vorlage = readFileSync(join(dir, art === "beleg" ? "rechnung.typ" : "mahnung.typ"), "utf8");
  const entwurf = readFileSync(join(dir, "entwurf.typ"), "utf8");
  if (!IMPORT.test(vorlage)) throw new Error("Die eingebaute Vorlage importiert entwurf.typ nicht mehr wie erwartet.");
  return vorlage.replace(IMPORT, `// Aus entwurf.typ: Vermerk eines Entwurfs und Platzhalter des GiroCodes\n${entwurf.trim()}\n`);
}
