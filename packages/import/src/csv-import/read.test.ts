import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectDelimiter, MAX_IMPORT_ROWS, readCsvTable } from "./read.ts";

const auto = { encoding: "auto", delimiter: "auto" } as const;
const utf8 = (text: string) => new TextEncoder().encode(text);
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test-fixtures/csv-import/${name}`, import.meta.url)));

describe("readCsvTable", () => {
  it("erkennt Windows-1252 und Semikolon wie im Export von Excel unter Windows", () => {
    const result = readCsvTable(fixture("kontakte-windows-1252.csv"), auto);
    if (!result.ok) throw new Error(result.error);
    expect(result.table.encoding).toBe("windows-1252");
    expect(result.table.delimiter).toBe(";");
    expect(result.table.header).toContain("Straße");
    expect(result.table.rows[0]!.cells).toContain("Müller & Söhne GmbH");
  });

  it("liest UTF-8 mit BOM, ohne das BOM in den ersten Spaltennamen zu ziehen", () => {
    const result = readCsvTable(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Name;Ort\nÄrztehaus;Köln\n")]), auto);
    if (!result.ok) throw new Error(result.error);
    expect(result.table.encoding).toBe("utf-8-bom");
    expect(result.table.header).toEqual(["Name", "Ort"]);
    expect(result.table.rows[0]!.cells).toEqual(["Ärztehaus", "Köln"]);
  });

  it("liest UTF-8 ohne BOM", () => {
    const result = readCsvTable(utf8("Name,Ort\nÄrztehaus,Köln\n"), auto);
    expect(result.ok && result.table.encoding).toBe("utf-8");
    expect(result.ok && result.table.delimiter).toBe(",");
  });

  it("lehnt bei gewähltem UTF-8 eine Windows-1252-Datei mit Hinweis ab, statt Umlaute zu zerstören", () => {
    const result = readCsvTable(fixture("kontakte-windows-1252.csv"), { encoding: "utf-8", delimiter: "auto" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Windows-1252") });
  });

  it("nimmt die gewählte Kodierung und das gewählte Trennzeichen", () => {
    const result = readCsvTable(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a]), {
      encoding: "windows-1252",
      delimiter: ";",
    });
    expect(result.ok && result.table.rows[0]!.cells).toEqual(["Müller"]);
  });

  it("zählt Zeilen wie in der Datei, leere Zeilen fallen weg", () => {
    const result = readCsvTable(utf8('Name;Ort\n\nA;B\n"C\nD";E\nF;G\n'), auto);
    expect(result.ok && result.table.rows.map((r) => r.line)).toEqual([3, 4, 5]);
    expect(result.ok && result.table.rows[1]!.cells[0]).toBe("C\nD");
  });

  it("meldet leere Dateien, eine Kopfzeile ohne Daten und zu viele Zeilen", () => {
    expect(readCsvTable(new Uint8Array(), auto)).toEqual({ ok: false, error: "Die Datei ist leer." });
    expect(readCsvTable(utf8("Name;Ort\n"), auto)).toEqual({ ok: false, error: expect.stringContaining("nur eine Kopfzeile") });
    const many = `Name\n${"x\n".repeat(MAX_IMPORT_ROWS + 1)}`;
    expect(readCsvTable(utf8(many), auto)).toEqual({ ok: false, error: expect.stringContaining("Höchstens") });
  });
});

describe("detectDelimiter", () => {
  it("wählt Tabulator, Komma oder Semikolon nach gleichmäßigen Spalten", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter('Name,Preis\n"Beratung, vor Ort","1.200,00"\n')).toBe(",");
    // Kommas in Beträgen machen ein Semikolon-CSV nicht zum Komma-CSV
    expect(detectDelimiter("Name;Preis\nBeratung;1.200,50\nReise;80,00\n")).toBe(";");
  });
});
