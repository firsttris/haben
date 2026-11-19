import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * checks.json von Haben mit dem Paket @firsttris/checks: Fehlt eine Liste in .checks/, bricht die Prüfung ab, wie
 * früher scripts/dateigroesse ohne altdateien.json und scripts/seitenabdeckung ohne ausnahmen.ts, statt jede alte
 * Datei oder Seite als neu zu melden oder mit --clean eine leere Liste zu schreiben.
 */

const WURZEL = resolve(__dirname, "../..");
const CLI = createRequire(import.meta.url).resolve("@firsttris/checks/checks/cli.ts");
const DATEIEN = ["checks.json", "apps/web/src/routeTree.gen.ts", "apps/web/e2e/seiten.spec.ts", "apps/web/e2e/barrierefreiheit.spec.ts"];

/** Ein Ordner mit der Einstellung, dem Routenbaum und den Specs von Haben, ohne .checks/ */
function projektOhneListen(): string {
  const ordner = mkdtempSync(join(tmpdir(), "checks-"));
  for (const datei of DATEIEN) {
    mkdirSync(dirname(join(ordner, datei)), { recursive: true });
    copyFileSync(join(WURZEL, datei), join(ordner, datei));
  }
  // Ohne packages/ bricht file-size ab wie früher scripts/dateigroesse (readdirSync("packages"))
  mkdirSync(join(ordner, "packages"));
  return ordner;
}

const checks = (ordner: string, ...args: string[]) => spawnSync("bun", [CLI, ...args], { cwd: ordner, encoding: "utf8" });

describe("checks mit der Einstellung von Haben", () => {
  it.each([[[]], [["--clean"]], [["--init"]]])("file-size %j bricht ohne .checks/large-files.txt ab und schreibt keine", (args) => {
    const ordner = projektOhneListen();
    const lauf = checks(ordner, "file-size", ...args);
    expect(lauf.status).toBe(1);
    expect(lauf.stderr).toContain(".checks/large-files.txt not found");
    expect(existsSync(join(ordner, ".checks/large-files.txt"))).toBe(false);
  });

  it("pages bricht ohne .checks/pages.txt ab, statt jede Ausnahme als fehlende Seite zu melden", () => {
    const lauf = checks(projektOhneListen(), "pages");
    expect(lauf.status).toBe(1);
    expect(lauf.stderr).toContain(".checks/pages.txt not found");
    expect(lauf.stderr).not.toContain("is missing");
  });
});

describe("Meldungen wie früher (language: de)", () => {
  /** Wie projektOhneListen, mit den Ausnahmen der Seiten und einer eigenen Liste großer Dateien */
  function projekt(grosseDateien: string[]): string {
    const ordner = projektOhneListen();
    mkdirSync(join(ordner, ".checks"));
    copyFileSync(join(WURZEL, ".checks/pages.txt"), join(ordner, ".checks/pages.txt"));
    writeFileSync(join(ordner, ".checks/large-files.txt"), grosseDateien.map((datei) => `${datei}\n`).join(""));
    return ordner;
  }

  it("file-size meldet wie scripts/dateigroesse, mit der Liste und dem Befehl von heute", () => {
    const ordner = projekt(["apps/web/src/weg.ts"]);
    writeFileSync(join(ordner, "apps/web/src/neu.ts"), "x\n".repeat(401));
    const lauf = checks(ordner, "file-size");
    expect(lauf.status).toBe(1);
    expect(lauf.stdout).toBe("Hinweis: apps/web/src/weg.ts  gelöscht: kann mit `bun checks file-size --clean` aus .checks/large-files.txt.\n");
    expect(lauf.stderr).toBe(
      "apps/web/src/neu.ts  401 Zeilen, mehr als 400 und nicht in .checks/large-files.txt: Neues in eine eigene Datei legen. Ist es eine umbenannte alte Datei, den Pfad in .checks/large-files.txt mit ändern.\n" +
        "\nDateigröße: 1 Datei über 400 Zeilen, nicht in .checks/large-files.txt\n",
    );
  });

  it("file-size zählt apps/node_modules/src wie scripts/dateigroesse, das node_modules nur unter src übersprang", () => {
    const ordner = projekt([]);
    mkdirSync(join(ordner, "apps/node_modules/src"), { recursive: true });
    writeFileSync(join(ordner, "apps/node_modules/src/a.ts"), "x\n".repeat(401));
    mkdirSync(join(ordner, "apps/web/src/node_modules"), { recursive: true });
    writeFileSync(join(ordner, "apps/web/src/node_modules/b.ts"), "x\n".repeat(401));
    const lauf = checks(ordner, "file-size");
    expect(lauf.status).toBe(1);
    expect(lauf.stderr).toBe(
      "apps/node_modules/src/a.ts  401 Zeilen, mehr als 400 und nicht in .checks/large-files.txt: Neues in eine eigene Datei legen. Ist es eine umbenannte alte Datei, den Pfad in .checks/large-files.txt mit ändern.\n" +
        "\nDateigröße: 1 Datei über 400 Zeilen, nicht in .checks/large-files.txt\n",
    );
  });

  it("file-size --clean schreibt die Liste ohne Ausgabe wie früher --aufraeumen", () => {
    const ordner = projekt(["apps/web/src/weg.ts"]);
    const lauf = checks(ordner, "file-size", "--clean");
    expect([lauf.status, lauf.stdout, lauf.stderr]).toEqual([0, "", ""]);
    expect(readFileSync(join(ordner, ".checks/large-files.txt"), "utf8")).not.toContain("weg.ts");
  });

  it("pages meldet wie scripts/seitenabdeckung, eine Zeile für eine unbekannte Spec bricht ab", () => {
    const ordner = projekt([]);
    const baum = join(ordner, "apps/web/src/routeTree.gen.ts");
    writeFileSync(
      baum,
      readFileSync(baum, "utf8").replace("export interface FileRoutesByFullPath {", "export interface FileRoutesByFullPath {\n  '/zz-neu': typeof X"),
    );
    const lauf = checks(ordner, "pages");
    expect([lauf.status, lauf.stdout]).toEqual([1, ""]);
    expect(lauf.stderr).toBe(
      "apps/web/e2e/seiten.spec.ts: Seite /zz-neu fehlt\napps/web/e2e/barrierefreiheit.spec.ts: Seite /zz-neu fehlt\n\nSeitenabdeckung: 2 Meldungen\n",
    );
    writeFileSync(join(ordner, ".checks/pages.txt"), "apps/web/e2e/gibtsnicht.spec.ts /bank open\n", { flag: "a" });
    expect(checks(ordner, "pages").stderr).toBe(
      ".checks/pages.txt: apps/web/e2e/gibtsnicht.spec.ts ist keine Spec-Datei aus checks.json (pages.specs)\n\nSeitenabdeckung: 1 Meldung\n",
    );
  });
});
