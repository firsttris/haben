import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/*
 * Die Regel steht in kein-as-einheit.grit und läuft mit `bun run lint` (biome.jsonc, plugins). Hier wird sie an kleinen
 * Beispielen geprüft: Biome liest die Datei im Repo, weil es Plugins nur dort mit der Konfiguration lädt.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const probe = fileURLToPath(new URL(`zz-probe-${process.pid}.ts`, import.meta.url));

afterAll(() => rmSync(probe, { force: true }));

/** Meldungen der Regel für diesen Ausdruck: Zahl der Fehler im Ergebnis von `biome lint` */
function findings(expression: string): number {
  writeFileSync(probe, `declare const wert: number;\ntype Cents = number;\ntype K = string;\nexport const probe = ${expression};\n`);
  const result = spawnSync("bun", ["--bun", "biome", "lint", "--only=plugin", probe], { cwd: root, encoding: "utf8", timeout: 60_000 });
  return Number(/Found (\d+) error/.exec(`${result.stdout}${result.stderr}`)?.[1] ?? 0);
}

describe("Kein as mit Einheit", () => {
  it.each([
    ["wert as Cents", "Cent"],
    ["wert as BasisPoints", "Basispunkte"],
    ["wert as Millis", "Tausendstel"],
    ["wert as Prozent", "Prozent"],
    ["(wert as unknown) as Cents", "über unknown"],
    ["wert as Cents | null", "nullbar"],
    ["wert as undefined | BasisPoints", "undefined vorn"],
    ["<Cents>wert", "spitze Klammern"],
    ["[wert] as Cents[]", "Array"],
    ["[wert] as readonly BasisPoints[]", "Array nur zum Lesen"],
    ["[wert] as Array<Millis>", "Array in Langform"],
    ["[wert] as ReadonlyArray<Prozent> | null", "ReadonlyArray, nullbar"],
  ])("meldet %s (%s)", (expression) => {
    expect(findings(expression)).toBe(1);
  });

  it.each([
    ["wert as number", "ohne Einheit"],
    ["Object.entries({}) as [K, Cents][]", "nur der Schlüssel wird enger"],
    ["{ betrag: wert } satisfies { betrag: Cents }", "satisfies prüft nur"],
    ["wert as CentsProZeile", "anderer Name, der mit Cents beginnt"],
    ["[wert] as number[]", "Array ohne Einheit"],
    ["[wert] as Array<CentsProZeile>", "Array eines anderen Typs"],
  ])("lässt %s zu (%s)", (expression) => {
    expect(findings(expression)).toBe(0);
  });
});
