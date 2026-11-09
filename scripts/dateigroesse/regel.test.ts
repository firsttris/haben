import { describe, expect, it } from "vitest";
import { check, countLines, lowered } from "./regel.ts";

describe("countLines", () => {
  it("zählt wie wc -l", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
  });
});

describe("check", () => {
  it("lässt kleine Dateien und alte große bis zu ihrer Grenze durch", () => {
    expect(check({ "a.ts": 400, "alt.ts": 900 }, { "alt.ts": 900 })).toEqual([]);
  });

  it("meldet eine neue Datei über 400 Zeilen", () => {
    expect(check({ "neu.ts": 401 }, {})).toEqual([{ file: "neu.ts", message: expect.stringContaining("aufteilen") }]);
  });

  it("meldet eine alte Datei, die gewachsen ist", () => {
    expect(check({ "alt.ts": 901 }, { "alt.ts": 900 })).toEqual([{ file: "alt.ts", message: expect.stringContaining("darf nicht wachsen") }]);
  });

  it("verlangt, eine geschrumpfte oder gelöschte Datei zu senken", () => {
    const reports = check({ "alt.ts": 700 }, { "alt.ts": 900, "weg.ts": 500 });
    expect(reports.map((r) => r.file)).toEqual(["alt.ts", "weg.ts"]);
    expect(reports[0].message).toContain("--senken");
  });
});

describe("lowered", () => {
  it("senkt nur, nimmt kleine und gelöschte Dateien heraus und sortiert", () => {
    expect(lowered({ "b.ts": 700, "a.ts": 950, "klein.ts": 380 }, { "b.ts": 900, "a.ts": 900, "klein.ts": 600, "weg.ts": 500 })).toEqual({
      "a.ts": 900,
      "b.ts": 700,
    });
  });
});
