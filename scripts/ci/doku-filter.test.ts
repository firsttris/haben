import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Aenderung = { schreiben?: Record<string, string>; loeschen?: string[]; verschieben?: [string, string][] };

const GIT_UMGEBUNG = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

// Liest den echten Block aus der Workflow-Datei, damit der Test nicht gegen eine Kopie läuft
const filterSkript = (): string => {
  const zeilen = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").split("\n");
  const start = zeilen.findIndex((z) => z.trim() === "- id: filter") + 2;
  const einzug = zeilen[start].length - zeilen[start].trimStart().length;
  const ende = zeilen.findIndex((z, i) => i >= start && z.trim() !== "" && z.length - z.trimStart().length < einzug);
  return zeilen.slice(start, ende).join("\n");
};

const ordner: string[] = [];
afterEach(() => {
  for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: { ...process.env, ...GIT_UMGEBUNG }, stdio: "pipe" });

const schreibe = (cwd: string, pfad: string, inhalt: string) => {
  mkdirSync(dirname(join(cwd, pfad)), { recursive: true });
  writeFileSync(join(cwd, pfad), inhalt);
};

const BESTAND = {
  "docs/seite.md": "alt\n",
  "README.md": "alt\n",
  LICENSE: "alt\n",
  "src/a.ts": "alt\n",
  "packages/einvoice/src/cii.ts": "alt\n",
  "packages/core/src/geld.ts": "alt\n",
  "packages/import/src/bank.ts": "alt\n",
  "deploy/backup/backup.sh": "alt\n",
  "apps/web/drizzle/0001_start.sql": "alt\n",
  "apps/web/package.json": "alt\n",
  "bun.lock": "alt\n",
  ".github/workflows/ci.yml": "alt\n",
};

// Baut wie GitHub einen Merge-Commit, dessen erster Elternteil die Basis ist, und führt den Filter darauf aus; gibt
// die Ausgaben des Schritts zurück (code, einvoice, deploy)
const filterFuer = (aenderung: Aenderung): Record<string, string> => {
  const cwd = mkdtempSync(join(tmpdir(), "doku-filter-"));
  ordner.push(cwd);
  git(cwd, "init", "-q", "-b", "main");
  for (const [pfad, inhalt] of Object.entries(BESTAND)) schreibe(cwd, pfad, inhalt);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "Basis");
  git(cwd, "switch", "-q", "-c", "pr");
  for (const [pfad, inhalt] of Object.entries(aenderung.schreiben ?? {})) schreibe(cwd, pfad, inhalt);
  for (const pfad of aenderung.loeschen ?? []) git(cwd, "rm", "-q", pfad);
  for (const [von, nach] of aenderung.verschieben ?? []) {
    mkdirSync(dirname(join(cwd, nach)), { recursive: true });
    git(cwd, "mv", von, nach);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "Änderung");
  git(cwd, "switch", "-q", "main");
  git(cwd, "merge", "-q", "--no-ff", "-m", "Merge", "pr");

  const ausgabe = join(cwd, ".git", "github-output");
  execFileSync("bash", ["-c", filterSkript()], { cwd, env: { ...process.env, GITHUB_OUTPUT: ausgabe }, stdio: "pipe" });
  return Object.fromEntries(
    readFileSync(ausgabe, "utf8")
      .trim()
      .split("\n")
      .map((zeile) => zeile.split("=") as [string, string]),
  );
};

describe("Filter des Jobs changes in ci.yml", () => {
  it("überspringt die Prüfungen bei geändertem oder neuem Markdown, docs/ und LICENSE", () => {
    expect(filterFuer({ schreiben: { "docs/seite.md": "neu\n", "docs/neu.md": "neu\n", "README.md": "neu\n", LICENSE: "neu\n" } }).code).toBe("false");
  });

  it("prüft bei geändertem Code", () => {
    expect(filterFuer({ schreiben: { "src/a.ts": "neu\n", "docs/seite.md": "neu\n" } }).code).toBe("true");
  });

  // scripts/jahreswerte/normen.json nennt Seiten unter docs/, und normen.test.ts verlangt, dass es sie gibt
  it("prüft, wenn eine Seite unter docs/ gelöscht wird", () => {
    expect(filterFuer({ loeschen: ["docs/seite.md"] }).code).toBe("true");
  });

  it("prüft, wenn eine Seite innerhalb von docs/ verschoben wird", () => {
    expect(filterFuer({ verschieben: [["docs/seite.md", "docs/umzug/seite.md"]] }).code).toBe("true");
  });

  it("prüft, wenn Code nach docs/ verschoben wird", () => {
    expect(filterFuer({ verschieben: [["src/a.ts", "docs/a.md"]] }).code).toBe("true");
  });

  // kosit und zugferd prüfen nur, was packages/einvoice erzeugt; backup und db-upgrade nur Images und Migrationen
  it.each([
    ["Code in apps/web", { schreiben: { "src/a.ts": "neu\n" } }, "false", "false"],
    ["Code in packages/import", { schreiben: { "packages/import/src/bank.ts": "neu\n" } }, "false", "false"],
    ["Abhängigkeit nur in apps/web/package.json", { schreiben: { "apps/web/package.json": "neu\n" } }, "false", "false"],
    ["Code in packages/einvoice", { schreiben: { "packages/einvoice/src/cii.ts": "neu\n" } }, "true", "false"],
    ["neue Datei in packages/einvoice", { schreiben: { "packages/einvoice/templates/neu.typ": "neu\n" } }, "true", "false"],
    ["Code in packages/core", { schreiben: { "packages/core/src/geld.ts": "neu\n" } }, "true", "false"],
    ["gelöschte Datei in packages/einvoice", { loeschen: ["packages/einvoice/src/cii.ts"] }, "true", "false"],
    ["aus packages/einvoice verschoben", { verschieben: [["packages/einvoice/src/cii.ts", "src/cii.ts"]] }, "true", "false"],
    ["neue Migration", { schreiben: { "apps/web/drizzle/0002_neu.sql": "neu\n" } }, "false", "true"],
    ["deploy/", { schreiben: { "deploy/backup/backup.sh": "neu\n" } }, "false", "true"],
    ["bun.lock", { schreiben: { "bun.lock": "neu\n" } }, "true", "true"],
    ["ci.yml", { schreiben: { ".github/workflows/ci.yml": "neu\n" } }, "true", "true"],
    ["nur Doku", { schreiben: { "docs/seite.md": "neu\n" } }, "false", "false"],
  ] as [string, Aenderung, string, string][])("%s: einvoice=%s, deploy=%s", (_name, aenderung, einvoice, deploy) => {
    const ausgabe = filterFuer(aenderung);
    expect(ausgabe.einvoice).toBe(einvoice);
    expect(ausgabe.deploy).toBe(deploy);
  });
});
