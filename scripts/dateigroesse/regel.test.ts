import { describe, expect, it } from "vitest";
import { countLines, grownOldFiles, largeFiles, newLargeFiles, removableOldFiles } from "./regel.ts";

describe("countLines", () => {
  it("zählt wie wc -l", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
  });
});

describe("newLargeFiles", () => {
  it("lässt kleine Dateien und alte große durch, auch wenn diese wachsen", () => {
    expect(newLargeFiles({ "a.ts": 400, "alt.ts": 3000 }, ["alt.ts"])).toEqual([]);
  });

  it("meldet eine neue Datei über 400 Zeilen", () => {
    expect(newLargeFiles({ "neu.ts": 401 }, [])).toEqual([{ file: "neu.ts", message: expect.stringContaining("aufteilen") }]);
  });
});

describe("removableOldFiles", () => {
  it("nennt geschrumpfte und gelöschte alte Dateien", () => {
    const reports = removableOldFiles({ "alt.ts": 900, "klein.ts": 380 }, ["alt.ts", "klein.ts", "weg.ts"]);
    expect(reports.map((r) => r.file)).toEqual(["klein.ts", "weg.ts"]);
    expect(reports[0].message).toContain("--aufraeumen");
  });
});

describe("largeFiles", () => {
  it("behält nur vorhandene große Dateien, sortiert", () => {
    expect(largeFiles({ "b.ts": 700, "a.ts": 950, "klein.ts": 380 }, ["b.ts", "klein.ts", "weg.ts", "a.ts"])).toEqual(["a.ts", "b.ts"]);
  });
});

describe("grownOldFiles", () => {
  it("nennt nur alte Dateien, die gewachsen sind", () => {
    const before = { "alt.ts": 900, "andere.ts": 500, "neu-klein.ts": 10 };
    const after = { "alt.ts": 901, "andere.ts": 480, "neu-klein.ts": 20 };
    expect(grownOldFiles(before, after, ["alt.ts", "andere.ts"])).toEqual([{ file: "alt.ts", before: 900, after: 901 }]);
  });

  it("übergeht alte Dateien, die vorher oder nachher fehlen", () => {
    expect(grownOldFiles({}, { "alt.ts": 900 }, ["alt.ts"])).toEqual([]);
  });
});
