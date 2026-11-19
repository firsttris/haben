import { functionLengths as countFunctions } from "@firsttris/checks/checks/function-length.ts";
import { describe, expect, it } from "vitest";
import { ANONYMOUS, checksFunctions, functionLengthHints } from "./funktionslaenge.ts";

/** Gezählt wird im Paket; die Fälle bleiben hier, damit sich zeigt, dass es so zählt wie zuvor das eigene Skript */
const functionLengths = (file: string, code: string) => countFunctions(file, code, ANONYMOUS);

/** Funktion mit `lines` Zeilen nach Biome: so viele Anweisungen im Rumpf, dazwischen Leerzeilen, die nicht zählen */
const fn = (name: string, lines: number) => `export function ${name}() {\n${Array.from({ length: lines }, (_, i) => `  const v${i} = ${i};\n`).join("\n")}}\n`;

const FILE = "packages/core/src/ust.ts";

describe("functionLengths", () => {
  it("zählt wie Biome nur Zeilen des Rumpfs, die mit Code beginnen", () => {
    expect(functionLengths(FILE, fn("lang", 81)).get("lang")).toBe(81);
    const code = [
      "export function f(",
      "  a: number,",
      ") {",
      "  // Kommentar",
      "  /* über",
      "     zwei Zeilen */ const t = `x",
      "  $" + "{a}",
      "  y`;",
      "  if (a) {",
      "    g({",
      "      a,",
      "    });",
      "  } else {",
      "    return (",
      "      <div>",
      "        Text",
      "        <b>{a}</b>",
      "      </div>",
      "    );",
      "  }",
      "}",
    ].join("\n");
    // const t, if, g, a, return, <div>, ); – nachgezählt mit Biome 2.6.4 und maxLines 1
    expect(functionLengths("x.tsx", code).get("f")).toBe(7);
  });

  it("kennt Deklaration, Ausdruck, Pfeilfunktion und Methode, mit Namen aus Variable und Schlüssel", () => {
    const code = [
      "function a() {}",
      "const b = function () {};",
      "const c = (x: number) => x;",
      "const d = (() => 1) as unknown;",
      "class K { m() {}\n  f = () => {}; }",
      "const o = { p() {}, q: () => 1 };",
      "export const s = wrap(async () => {});",
      "declare function t(): void;",
    ].join("\n");
    expect([...functionLengths("x.ts", code).keys()]).toEqual(["a", "b", "c", "d", "K › m", "K › f", "o › p", "o › q", "s › (anonym)"]);
  });

  it("lässt Getter und Setter aus wie Biome", () => {
    // nachgeprüft mit Biome 2.6.4 und maxLines 1: nur m wird gemeldet
    const code =
      "class K {\n  get g() {\n    a();\n    b();\n  }\n  set s(v) {\n    a();\n    b();\n  }\n  m() {\n    a();\n    b();\n  }\n}\nconst o = {\n  get h() {\n    a();\n    b();\n  },\n};\n";
    expect([...functionLengths("x.ts", code).keys()]).toEqual(["K › m"]);
  });

  it("hält gleiche Namen auseinander", () => {
    expect([...functionLengths("x.ts", "const x = [() => {}, () => {}];").keys()]).toEqual(["x › (anonym)", "x › (anonym) #2"]);
  });
});

describe("functionLengthHints", () => {
  it("meldet eine neue Funktion über 80 Zeilen, auch in einer neuen Datei", () => {
    expect(functionLengthHints([{ file: FILE, before: fn("kurz", 10), after: fn("kurz", 10) + fn("neu", 81) }])).toEqual([
      { level: "warning", message: expect.stringContaining("packages/core/src/ust.ts: Funktion „neu“ ist neu mit 81 Zeilen") },
    ]);
    expect(functionLengthHints([{ file: "scripts/x/y.ts", before: null, after: fn("neu", 90) }])).toHaveLength(1);
  });

  it("meldet eine über die Grenze oder weiter gewachsene Funktion mit Zeilen vorher und nachher", () => {
    const reports = functionLengthHints([{ file: FILE, before: fn("a", 80) + fn("b", 120), after: fn("a", 81) + fn("b", 195) }]).map(({ message }) => message);
    expect(reports).toEqual([
      expect.stringContaining("„a“ wächst von 80 auf 81 Zeilen, über 80: vor dem Merge teilen"),
      expect.stringContaining("„b“ wächst von 120 auf 195 Zeilen (Grenze 80): das Neue vor dem Merge in eine eigene Funktion legen"),
    ]);
  });

  /** Rückruf ohne Namen auf oberster Ebene, etwa `beforeAll(() => {})` in einem Skript */
  const callback = (lines: number) => `on(() => {\n${Array.from({ length: lines }, (_, i) => `  a${i}();\n`).join("")}});\n`;

  it("schweigt, wenn vor einer langen Funktion eine gleichnamige eingefügt wird", () => {
    const before = callback(100) + callback(5);
    const after = callback(3) + callback(100) + callback(5);
    expect(functionLengthHints([{ file: "scripts/x/y.ts", before, after }])).toEqual([]);
  });

  it("meldet eine gewachsene unter gleichnamigen Funktionen mit ihrer alten Länge", () => {
    const before = callback(90) + callback(50);
    const after = callback(90) + callback(95);
    expect(functionLengthHints([{ file: "scripts/x/y.ts", before, after }]).map(({ message }) => message)).toEqual([
      expect.stringContaining("wächst von 50 auf 95 Zeilen"),
    ]);
    const kuerzer = functionLengthHints([{ file: "scripts/x/y.ts", before: callback(100), after: callback(50) + callback(90) }]);
    expect(kuerzer.map(({ message }) => message)).toEqual([expect.stringContaining("„(anonym) #2“ ist neu mit 90 Zeilen")]);
  });

  it("schweigt bei unveränderten und geschrumpften langen Funktionen und bei 80 Zeilen", () => {
    const before = fn("alt", 150) + fn("schrumpft", 150);
    expect(functionLengthHints([{ file: FILE, before, after: `${fn("alt", 150)}${fn("schrumpft", 120)}${fn("grenze", 80)}` }])).toEqual([]);
  });

  it("nimmt Tests, E2E und Erzeugtes aus und prüft nur Code in App, Paketen und Skripten", () => {
    const lang = fn("lang", 100);
    for (const file of ["packages/core/src/ust.test.ts", "apps/web/src/a.spec.tsx", "apps/web/e2e/bank.ts", "apps/web/src/routeTree.gen.ts", "docs/a.ts"]) {
      expect(functionLengthHints([{ file, before: null, after: lang }])).toEqual([]);
    }
    expect(["apps/web/src/a.tsx", "apps/firmenportal/src/b.ts", "packages/elster/src/c.ts", "scripts/hero/render.mjs"].every(checksFunctions)).toBe(true);
  });
});
