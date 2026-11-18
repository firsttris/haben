import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunDir, redirectTempDirs, removeAbandonedRunDirs, workerDocumentsDir } from "./test-db.ts";

// Testläufe ließen je Testdatei einen Belegordner in $TMPDIR liegen (zuletzt rund 46.000 Ordner, 25 GB)
describe("Temp-Ordner der Tests", () => {
  it("lenkt tmpdir() der Worker und ihrer Kindprozesse in den Ordner des Laufs", () => {
    expect(basename(tmpdir())).toMatch(/^haben-test-\d+-/);
    const kind = spawnSync(process.execPath, ["-e", "console.log(require('node:os').tmpdir())"], { encoding: "utf8" });
    expect(kind.stdout.trim()).toBe(tmpdir());
  });

  it("lenkt TMPDIR, TMP und TEMP um und stellt sie danach wieder her (Windows liest TEMP, Watch-Neustart)", () => {
    const vorher = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    const ziel = mkdtempSync(join(tmpdir(), "umlenken-"));
    const zurueck = redirectTempDirs(ziel);
    try {
      expect([process.env.TMPDIR, process.env.TMP, process.env.TEMP]).toEqual([ziel, ziel, ziel]);
      expect(tmpdir()).toBe(ziel);
    } finally {
      zurueck();
    }
    expect({ TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }).toEqual(vorher);
  });

  it("legt den Ordner des Laufs an und löscht ihn am Ende samt Inhalt", () => {
    const base = mkdtempSync(join(tmpdir(), "lauf-"));
    const { root, remove } = createRunDir(base);
    expect(root.startsWith(join(base, `haben-test-${process.pid}-`))).toBe(true);
    mkdirSync(join(root, "haben-belege-1", "ab"), { recursive: true });
    writeFileSync(join(root, "haben-belege-1", "ab", "datei"), "x");
    remove();
    expect(readdirSync(base)).toEqual([]);
  });

  it("nimmt je Worker einen Belegordner und leert ihn beim nächsten Aufruf", () => {
    const first = workerDocumentsDir();
    writeFileSync(join(first, "datei"), "x");
    const second = workerDocumentsDir();
    expect(second).toBe(first);
    expect(dirname(second)).toBe(tmpdir());
    expect(readdirSync(second)).toEqual([]);
  });

  it("löscht Ordner abgebrochener Läufe, lässt laufende und fremde Ordner stehen", () => {
    const base = mkdtempSync(join(tmpdir(), "abgebrochen-"));
    const beendet = spawnSync(process.execPath, ["-e", ""]).pid;
    // process.ppid: ein anderer Prozess, der noch läuft (Elternprozess des Workers)
    const bleiben = [`haben-test-${process.pid}-def456`, `haben-test-${process.ppid}-jkl012`, "haben-belege-ghi789"];
    for (const name of [`haben-test-${beendet}-abc123`, ...bleiben]) mkdirSync(join(base, name, "inhalt"), { recursive: true });
    removeAbandonedRunDirs(base);
    expect(existsSync(join(base, `haben-test-${beendet}-abc123`))).toBe(false);
    expect(readdirSync(base).sort()).toEqual(bleiben.sort());
  });
});
