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

const BESTAND = { "docs/seite.md": "alt\n", "README.md": "alt\n", "LICENSE": "alt\n", "src/a.ts": "alt\n" };

// Baut wie GitHub einen Merge-Commit, dessen erster Elternteil die Basis ist, und führt den Filter darauf aus
const filterFuer = (aenderung: Aenderung): string => {
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
  return readFileSync(ausgabe, "utf8").trim();
};

describe("Filter des Jobs changes in ci.yml", () => {
  it("überspringt die Prüfungen bei geändertem oder neuem Markdown, docs/ und LICENSE", () => {
    expect(filterFuer({ schreiben: { "docs/seite.md": "neu\n", "docs/neu.md": "neu\n", "README.md": "neu\n", LICENSE: "neu\n" } })).toBe("code=false");
  });

  it("prüft bei geändertem Code", () => {
    expect(filterFuer({ schreiben: { "src/a.ts": "neu\n", "docs/seite.md": "neu\n" } })).toBe("code=true");
  });

  // scripts/jahreswerte/normen.json nennt Seiten unter docs/, und normen.test.ts verlangt, dass es sie gibt
  it("prüft, wenn eine Seite unter docs/ gelöscht wird", () => {
    expect(filterFuer({ loeschen: ["docs/seite.md"] })).toBe("code=true");
  });

  it("prüft, wenn eine Seite innerhalb von docs/ verschoben wird", () => {
    expect(filterFuer({ verschieben: [["docs/seite.md", "docs/umzug/seite.md"]] })).toBe("code=true");
  });

  it("prüft, wenn Code nach docs/ verschoben wird", () => {
    expect(filterFuer({ verschieben: [["src/a.ts", "docs/a.md"]] })).toBe("code=true");
  });
});
