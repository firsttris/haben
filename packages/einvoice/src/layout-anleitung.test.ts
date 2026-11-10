import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOKU, mitFeldern, SKILL } from "../../../scripts/feldvertrag/schreiben.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { BEISPIEL_PNG, layoutBeispiele } from "./layout-beispiele.ts";
import { GERUEST, layoutAnleitung, TYPST_VERSION } from "./layout-anleitung.ts";
import { compileWith, createCompiler, getCompiler, PACKAGE_DIR } from "./typst-compiler.ts";

const hinweis = "Feldvertrag geändert? `bun scripts/feldvertrag/schreiben.ts` schreibt Skill und Doku neu.";

describe("Anleitung für eigene Belegvorlagen", () => {
  it("der Skill im Repository ist die Anleitung aus dem Feldvertrag", () => {
    expect(readFileSync(SKILL, "utf8"), hinweis).toBe(layoutAnleitung());
  });

  it("die Feldtabellen in docs/belegvorlagen.md sind aktuell", () => {
    const doku = readFileSync(DOKU, "utf8");
    expect(doku, hinweis).toBe(mitFeldern(doku));
  });

  it("nennt die Typst-Version, mit der Haben setzt", () => {
    const datei = join(PACKAGE_DIR, "templates", "version-probe.typ");
    writeFileSync(datei, "#metadata(str(sys.version)) <v>");
    try {
      const typst = getCompiler();
      const ergebnis = typst.compile({ mainFilePath: datei });
      expect(typst.query(ergebnis.result!, { selector: "<v>" })[0].value).toBe(TYPST_VERSION);
    } finally {
      rmSync(datei);
    }
  });

  it.each(
    layoutBeispiele()
      .filter((b) => b.art === "beleg")
      .map((b) => [b.name, b] as const),
  )("das Grundgerüst setzt „%s“", (_name, beispiel) => {
    const ordner = mkdtempSync(join(tmpdir(), "haben-geruest-"));
    try {
      const vorlage = join(ordner, "vorlage.typ");
      writeFileSync(vorlage, GERUEST.replace(/^```typst\n/, "").replace(/```$/, ""));
      for (const datei of ["logo.png", "briefpapier.png"]) writeFileSync(join(ordner, datei), BEISPIEL_PNG);
      const pdf = compileWith(createCompiler(ordner), vorlage, beispiel.data, "2026-10-02", "Das Grundgerüst");
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });

  it("verweist nicht auf das Repository, damit er ohne läuft", () => {
    expect(layoutAnleitung()).not.toMatch(/packages\/|apps\/|scripts\/|github\.com/);
  });
});
