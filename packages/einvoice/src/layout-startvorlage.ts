import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_DIR } from "./typst-compiler.ts";

/*
 * Startvorlage für eigene Layouts: die eingebaute Vorlage als eine Datei. Ein eigenes Layout liest nichts außerhalb seines
 * Ordners, darum steht entwurf.typ (Vermerk und Platzhalter des GiroCodes) mit darin statt als Import.
 */

const IMPORT = /^#import "entwurf\.typ": entwurf-vermerk, girocode-feld\n/m;

const BASIS = /^#import "layout-basis\.typ": \*\n/m;

const lesen = (datei: string) => readFileSync(join(PACKAGE_DIR, "templates", datei), "utf8");

function mitEntwurf(vorlage: string): string {
  if (!IMPORT.test(vorlage)) throw new Error("Die eingebaute Vorlage importiert entwurf.typ nicht mehr wie erwartet.");
  return vorlage.replace(IMPORT, `// Aus entwurf.typ: Vermerk eines Entwurfs und Platzhalter des GiroCodes\n${lesen("entwurf.typ").trim()}\n`);
}

/**
 * Eine Vorlage aus templates/ als eine einzige Datei: Imports von layout-basis.typ (Unterbau der eingebauten Layouts) und
 * entwurf.typ stehen darin. So taugt jedes eingebaute Layout als Grundlage für ein eigenes.
 */
export function vorlageAlsDatei(datei: string): string {
  const vorlage = lesen(datei);
  if (!BASIS.test(vorlage)) return mitEntwurf(vorlage);
  return vorlage.replace(BASIS, `// Aus layout-basis.typ: gemeinsamer Unterbau der eingebauten Layouts\n${mitEntwurf(lesen("layout-basis.typ")).trim()}\n`);
}

/** Klar in der Fassung „Klassisch“ (rechnung.typ, mahnung.typ) als Startvorlage; bleibt für die Beispiele der Prüfung und für bestehende Links */
export function startvorlage(art: "beleg" | "mahnung"): string {
  return vorlageAlsDatei(art === "beleg" ? "rechnung.typ" : "mahnung.typ");
}
