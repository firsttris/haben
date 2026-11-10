import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BEISPIEL_PNG, layoutBeispiele } from "./layout-beispiele.ts";
import { layoutAnleitung } from "./layout-anleitung.ts";
import { fehlendeAngaben } from "./layout-pflicht.ts";
import { compileWith, getCompiler, PACKAGE_DIR } from "./typst-compiler.ts";

const hasPoppler = spawnSync("pdftotext", ["-v"]).status === 0;
const templates = join(PACKAGE_DIR, "templates");

function seiten(template: string, data: object): string[] {
  const typst = getCompiler();
  const dateien = ["logo.png", "briefpapier.png"].map((datei) => join(templates, datei));
  for (const datei of dateien) typst.mapShadow(datei, Buffer.from(BEISPIEL_PNG));
  const ordner = mkdtempSync(join(tmpdir(), "haben-pflicht-"));
  try {
    writeFileSync(join(ordner, "b.pdf"), compileWith(typst, join(templates, template), data, "2026-10-02", "Probe"));
    // Wie beim Hochladen: Text nach Lage und in der Reihenfolge des Inhalts, denn schräger Text wie der Vermerk zerfällt nach Lage
    const lesen = (...art: string[]) => execFileSync("pdftotext", [...art, join(ordner, "b.pdf"), "-"], { encoding: "utf8" }).split("\f");
    const roh = lesen("-raw");
    return lesen()
      .map((seite, i) => `${seite}\n${roh[i] ?? ""}`)
      .filter((seite) => seite.trim());
  } finally {
    for (const datei of dateien) typst.unmapShadow(datei);
    rmSync(ordner, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPoppler)("Pflichtangaben auf dem Blatt", () => {
  it.each(layoutBeispiele().map((b) => [b.name, b] as const))("die eingebaute Vorlage zeigt alles: %s", (_name, beispiel) => {
    expect(fehlendeAngaben(beispiel, seiten(beispiel.art === "beleg" ? "rechnung.typ" : "mahnung.typ", beispiel.data))).toEqual([]);
  });
});

describe("Prüfung der Pflichtangaben", () => {
  const rechnung = layoutBeispiele().find((b) => b.name === "Rechnung")!;
  const entwurf = layoutBeispiele().find((b) => b.name === "Rechnung als Entwurf")!;
  const voll = JSON.stringify(rechnung.data);

  it("meldet einen fehlenden Gesamtbetrag", () => {
    const d = rechnung.data as { totals: { gross: { value: string } } };
    const ohne = voll.replaceAll(d.totals.gross.value, "");
    expect(fehlendeAngaben(rechnung, [ohne]).join()).toContain("Gesamtbetrag");
  });

  it("verlangt die vollständige Anschrift des Ausstellers, nicht nur den Namen (§ 14 Abs. 4 Nr. 1 UStG)", () => {
    const ohne = voll.replaceAll("Lindenstraße 12", "").replaceAll("10969 Berlin", "");
    expect(fehlendeAngaben(rechnung, [ohne]).join()).toContain("Anschrift des Absenders");
  });

  it("verzeiht Leerraum und Umbrüche im Text des Blatts", () => {
    expect(fehlendeAngaben(rechnung, [voll.split("").join(" ")])).toEqual([]);
  });

  it("verlangt den Vermerk des Entwurfs auf jeder Seite", () => {
    const text = JSON.stringify(entwurf.data);
    expect(fehlendeAngaben(entwurf, [text, "nur Positionen"])).toContain("Vermerk „ENTWURF“ auf Seite 2");
  });
  it("verlangt den Steuersatz zu den Steuerbeträgen, nicht nur die Beträge (§ 14 Abs. 4 Nr. 8 UStG)", () => {
    const brutto = layoutBeispiele().find((b) => b.name.startsWith("Rechnung mit Bruttopreisen"))!;
    const ohneSaetze = JSON.stringify(brutto.data).replace(/\d+(,\d+)? %/g, "");
    expect(fehlendeAngaben(brutto, [ohneSaetze]).join()).toContain("Steuersatz");
  });

  it("die Anleitung verspricht keine Anschrift nur in der Fußzeile, die die Prüfung ablehnt", () => {
    // Ein Layout ohne Absenderzeile, das die Anschrift nur aus footer zeigt: Im Beispiel „Rechnung“ steht dort keine PLZ und kein Ort
    const d = rechnung.data as { senderLine: string; author: string };
    const nurFuss = voll.replaceAll(d.senderLine, d.author);
    expect(fehlendeAngaben(rechnung, [nurFuss]).join()).toContain("Anschrift des Absenders");
    expect(layoutAnleitung()).not.toMatch(/Anschrift darf auch nur im `footer` stehen/);
  });
});
