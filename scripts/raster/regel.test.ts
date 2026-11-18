import { describe, expect, it } from "vitest";
import { allowedList, newOffGrid, offGridDeclarations, removableEntries } from "./regel.ts";

describe("offGridDeclarations", () => {
  it("findet padding, margin und gap mit px-Werten neben dem Raster, mit Zeile", () => {
    const css = ".a { gap: 6px; padding: 8px; }\n.b { margin-top: -2px; padding-inline: 0 10px; row-gap: 4px; }\n.c { column-gap: 3px }";
    expect(offGridDeclarations(css)).toEqual([
      { line: 1, declaration: "gap: 6px" },
      { line: 2, declaration: "margin-top: -2px" },
      { line: 2, declaration: "padding-inline: 0 10px" },
      { line: 3, declaration: "column-gap: 3px" },
    ]);
  });

  it("lässt Werte auf dem Raster, andere Einheiten und andere Eigenschaften durch", () => {
    const css = ".a { padding: 0 12px; margin: -8px auto; gap: 0.5rem; width: 6px; scroll-padding: 6px; border: 1px solid; }";
    expect(offGridDeclarations(css)).toEqual([]);
  });

  it("prüft px in calc() und Bruchteile", () => {
    expect(offGridDeclarations(".a { margin: calc(100% - 6px); padding: 0.5px; }").map((f) => f.declaration)).toEqual([
      "margin: calc(100% - 6px)",
      "padding: 0.5px",
    ]);
  });

  it("übergeht Kommentare und Klassennamen, behält die Zeilen", () => {
    expect(offGridDeclarations("/* gap: 6px\n */ .gap:hover { color: red; }\n.x { padding: 2px }")).toEqual([{ line: 3, declaration: "padding: 2px" }]);
  });
});

describe("newOffGrid", () => {
  const found = {
    "a.css": [
      { line: 1, declaration: "gap: 6px" },
      { line: 5, declaration: "gap: 6px" },
      { line: 9, declaration: "padding: 2px" },
    ],
  };

  it("lässt erfasste Stellen durch", () => {
    expect(newOffGrid(found, { "a.css": { "gap: 6px": 2, "padding: 2px": 1 } })).toEqual([]);
  });

  it("meldet eine neue Deklaration und eine, die öfter vorkommt als erlaubt", () => {
    const reports = newOffGrid(found, { "a.css": { "gap: 6px": 1 } });
    expect(reports.map((r) => r.file)).toEqual(["a.css:1", "a.css:5", "a.css:9"]);
    expect(reports[0].message).toContain("durch 4 teilbar");
  });

  it("meldet Stellen in einer Datei, die nicht in der Liste steht", () => {
    expect(newOffGrid({ "neu.css": [{ line: 2, declaration: "gap: 6px" }] }, {}).map((r) => r.file)).toEqual(["neu.css:2"]);
  });
});

describe("removableEntries", () => {
  it("nennt Einträge, die seltener oder nicht mehr vorkommen", () => {
    const reports = removableEntries(
      { "a.css": [{ line: 1, declaration: "gap: 6px" }] },
      { "a.css": { "gap: 6px": 2, "padding: 2px": 1 }, "weg.css": { "gap: 2px": 1 } },
    );
    expect(reports.map((r) => r.file)).toEqual(["a.css", "a.css", "weg.css"]);
    expect(reports[0].message).toContain("--aufraeumen");
  });
});

describe("allowedList", () => {
  const found = {
    "b.css": [{ line: 1, declaration: "gap: 6px" }],
    "a.css": [
      { line: 1, declaration: "padding: 2px" },
      { line: 2, declaration: "gap: 6px" },
      { line: 3, declaration: "gap: 6px" },
    ],
    "leer.css": [],
  };

  it("erfasst alles, sortiert", () => {
    expect(allowedList(found)).toEqual({ "a.css": { "gap: 6px": 2, "padding: 2px": 1 }, "b.css": { "gap: 6px": 1 } });
    expect(Object.keys(allowedList(found))).toEqual(["a.css", "b.css"]);
  });

  it("räumt auf, nimmt aber nichts Neues auf", () => {
    expect(allowedList(found, { "a.css": { "gap: 6px": 3 }, "weg.css": { "gap: 2px": 1 } })).toEqual({ "a.css": { "gap: 6px": 2 } });
  });
});
