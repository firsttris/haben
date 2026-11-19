import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
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
