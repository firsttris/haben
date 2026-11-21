import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type EingebautesLayout, layoutOptionen, layoutVorlagen } from "@haben/core";
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

/** In layout-basis.typ: Optionen aus look.options, die ein eigenes Layout leer bekommt (Feldvertrag v1) */
const OPTIONEN = /^\/\/ Optionen des Layouts aus dem Katalog[^\n]*\n#let optionen = look\.at\("options", default: \(:\)\)\n/m;

const typstDict = (werte: Readonly<Record<string, string>>) => {
  const paare = Object.entries(werte).map(([name, wert]) => `${name}: ${JSON.stringify(wert)}`);
  return paare.length === 0 ? "(:)" : `(${paare.join(", ")})`;
};

/** Gewählte Werte als Text, etwa „Fuß: Unten, Kerndaten: Zweispaltig“ */
export function varianteName(layout: EingebautesLayout, optionen: Readonly<Record<string, string>>): string {
  return layout.optionen
    .flatMap((option) => {
      const wert = option.werte.find((w) => w.id === optionen[option.id]);
      return wert ? [`${option.name}: ${wert.name}`] : [];
    })
    .join(", ");
}

/**
 * Ein eingebautes Layout in einer Variante als eigenes Layout (#113): die Vorlage als eine Datei, die Optionen fest darin.
 * Ein eigenes Layout bekommt look.options leer; ohne feste Werte setzte es immer die erste Variante.
 */
export function eingebautesLayoutAlsDatei(
  layout: EingebautesLayout,
  gewaehlt: Readonly<Record<string, string>>,
  art: "beleg" | "mahnung",
): { dateiname: string; inhalt: string } {
  const optionen = layoutOptionen(layout, gewaehlt);
  const datei = vorlageAlsDatei(layoutVorlagen(layout, optionen)[art]);
  const variante = varianteName(layout, optionen);
  const kopf = `// Eingebautes Layout „${layout.name}“ aus Haben${variante ? ` (${variante})` : ""}, als Grundlage für ein eigenes Layout\n`;
  const fest = OPTIONEN.test(datei)
    ? datei.replace(
        OPTIONEN,
        `// Optionen des Layouts, fest auf die heruntergeladene Variante; ein eigenes Layout bekommt look.options leer\n#let optionen = ${typstDict(optionen)}\n`,
      )
    : datei;
  if (fest === datei && datei.includes('look.at("options"')) {
    throw new Error("layout-basis.typ liest die Optionen nicht mehr wie erwartet.");
  }
  const name = [layout.name, ...Object.values(optionen), art]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  return { dateiname: `${name}.typ`, inhalt: kopf + fest };
}
