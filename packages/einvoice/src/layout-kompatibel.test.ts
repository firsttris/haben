import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BEISPIEL_PNG, layoutBeispiele } from "./layout-beispiele.ts";
import { compileWith, createCompiler, getCompiler, PACKAGE_DIR } from "./typst-compiler.ts";

/*
 * Alte eigene Layouts dürfen nicht brechen (#113): Unter templates/kompatibel/v<n>/ liegen Vorlagen, wie sie zu einer
 * Version des Feldvertrags passten. Sie müssen mit den heutigen Daten jedes Beispiels weiter ein PDF/A ergeben; das
 * fängt auch Updates von Typst ab. Dazu die eingebauten Vorlagen von heute.
 */

const templates = join(PACKAGE_DIR, "templates");
const versionen = readdirSync(join(templates, "kompatibel")).map((version) => join(templates, "kompatibel", version));
const vorlagen = [templates, ...versionen].flatMap((ordner) => [
  { name: `${ordner === templates ? "heute" : ordner.split("/").at(-1)}/rechnung.typ`, art: "beleg" as const, pfad: join(ordner, "rechnung.typ") },
  { name: `${ordner === templates ? "heute" : ordner.split("/").at(-1)}/mahnung.typ`, art: "mahnung" as const, pfad: join(ordner, "mahnung.typ") },
]);

/** Eingefrorene Vorlagen setzen sich wie ein eigenes Layout nur aus ihrem Ordner; Typst liest nichts außerhalb */
function setzen(pfad: string, data: object): Uint8Array {
  const typst = dirname(pfad) === templates ? getCompiler() : createCompiler(dirname(pfad));
  const dateien = ["logo.png", "briefpapier.png"].map((datei) => join(dirname(pfad), datei));
  for (const datei of dateien) typst.mapShadow(datei, Buffer.from(BEISPIEL_PNG));
  try {
    return compileWith(typst, pfad, data, "2026-10-02", "Die Vorlage");
  } finally {
    for (const datei of dateien) typst.unmapShadow(datei);
  }
}

describe("Kompatibilität der Belegvorlagen", () => {
  it("es gibt mindestens die eingefrorene Version 1", () => {
    expect(versionen.map((ordner) => ordner.split("/").at(-1))).toContain("v1");
  });

  for (const vorlage of vorlagen) {
    const beispiele = layoutBeispiele().filter((beispiel) => beispiel.art === vorlage.art);
    it.each(beispiele.map((b) => [b.name, b] as const))(`${vorlage.name} setzt „%s“`, (_name, beispiel) => {
      const pdf = setzen(vorlage.pfad, beispiel.data);
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    });
  }
});
