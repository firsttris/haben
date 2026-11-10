import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/*
 * Die Regeln stehen in kein-label-field.grit und keine-nackte-auswahl.grit und laufen mit `bun run lint` (biome.jsonc, plugins).
 * Hier werden sie an kleinen Beispielen geprüft: Biome liest die Datei im Repo, weil es Plugins nur dort mit der Konfiguration lädt.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const probe = fileURLToPath(new URL(`zz-probe-${process.pid}.tsx`, import.meta.url));

afterAll(() => rmSync(probe, { force: true }));

/** Meldungen der Regeln für diesen Quelltext: Zahl der Fehler im Ergebnis von `biome lint` */
function findings(source: string): number {
  writeFileSync(probe, `export const A = () => (\n  <>\n    ${source}\n  </>\n);\n`);
  const result = spawnSync("bun", ["--bun", "biome", "lint", "--only=plugin", probe], { cwd: root, encoding: "utf8", timeout: 60_000 });
  return Number(/Found (\d+) error/.exec(`${result.stdout}${result.stderr}`)?.[1] ?? 0);
}

describe("Kein umschließendes label mit Klasse field", () => {
  it.each([
    ['<label className="field">Name<input /></label>', "einfach"],
    ['<label className="field weitere">Name<input /></label>', "mit weiterer Klasse"],
    ['<label className="weitere field">Name<input /></label>', "Klasse hinten"],
    ['<label className={"field"}>Name<input /></label>', "als Ausdruck"],
    ['<label className="field" style={{ gridColumn: "1 / -1" }}>Name<input /></label>', "mit style"],
  ])("meldet %s (%s)", (source) => {
    expect(findings(source)).toBe(1);
  });

  it.each([
    ['<label className="checkbox"><input type="checkbox" />Ja</label>', "Kontrollkästchen"],
    ['<label className="field-label" htmlFor="x">Name</label>', "Feldname von Field"],
    ['<div className="field"><label htmlFor="x">Name</label><input id="x" /></div>', "div statt label"],
    ['<label className="search-box"><input /></label>', "Suchfeld"],
  ])("lässt %s zu (%s)", (source) => {
    expect(findings(source)).toBe(0);
  });
});

describe("Keine Auswahlliste ohne Field", () => {
  it.each([
    ["<select><option>a</option></select>", "nackt"],
    ['<select className="x" value="a" onChange={() => {}}><option>a</option></select>', "mit Eigenschaften"],
    ['<div className="field"><select></select></div>', "div.field statt Field"],
    ["<label>Name<select></select></label>", "in einem label"],
    ['<select aria-label="Art" />', "selbstschließend"],
  ])("meldet %s (%s)", (source) => {
    expect(findings(source)).toBe(1);
  });

  it.each([
    ['<Field label="Art">{(control) => <select {...control}><option>a</option></select>}</Field>', "in Field"],
    ['<Field label="Art" hideLabel>{(control) => (<span><select {...control} /></span>)}</Field>', "tiefer in Field"],
    ['{/* biome-ignore lint/plugin: Zelle einer Tabelle */}\n    <select aria-label="Art"><option>a</option></select>', "mit Begründung ausgenommen"],
    ['{/* biome-ignore lint/plugin: Zelle einer Tabelle */}\n    <select aria-label="Art" />', "selbstschließend mit Begründung ausgenommen"],
    ['<input type="text" />', "anderes Feld"],
  ])("lässt %s zu (%s)", (source) => {
    expect(findings(source)).toBe(0);
  });
});
