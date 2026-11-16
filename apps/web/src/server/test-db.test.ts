import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeAbandonedRunDirs, testTempDir, workerDocumentsDir } from "./test-db.ts";

// Testläufe ließen je Testdatei einen Belegordner in $TMPDIR liegen (zuletzt rund 46.000 Ordner, 25 GB)
describe("Temp-Ordner der Tests", () => {
  it("legt Temp-Ordner unter dem Ordner des Laufs an, den das globalSetup am Ende löscht", () => {
    expect(testTempDir("probe-").startsWith(`${process.env.HABEN_TEST_TMP}/`)).toBe(true);
  });

  it("nimmt je Worker einen Belegordner und leert ihn beim nächsten Aufruf", () => {
    const first = workerDocumentsDir();
    writeFileSync(join(first, "datei"), "x");
    const second = workerDocumentsDir();
    expect(second).toBe(first);
    expect(second.startsWith(`${process.env.HABEN_TEST_TMP}/`)).toBe(true);
    expect(readdirSync(second)).toEqual([]);
  });

  it("löscht Ordner abgebrochener Läufe, lässt laufende und fremde Ordner stehen", () => {
    const base = testTempDir("abgebrochen-");
    const beendet = spawnSync(process.execPath, ["-e", ""]).pid;
    for (const name of [`haben-test-${beendet}-abc123`, `haben-test-${process.pid}-def456`, "haben-belege-ghi789"])
      mkdirSync(join(base, name, "inhalt"), { recursive: true });
    removeAbandonedRunDirs(base);
    expect(existsSync(join(base, `haben-test-${beendet}-abc123`))).toBe(false);
    expect(readdirSync(base).sort()).toEqual([`haben-test-${process.pid}-def456`, "haben-belege-ghi789"].sort());
  });
});
