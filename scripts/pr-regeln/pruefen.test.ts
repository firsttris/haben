import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* Lokaler Aufruf von pruefen.ts vor dem Push (Skill `beitrag`, Schritt 4), in einem eigenen kleinen Repository */

const SKRIPT = resolve(__dirname, "pruefen.ts");
let repo: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
const datei = (pfad: string, inhalt: string) => {
  mkdirSync(join(repo, pfad, ".."), { recursive: true });
  writeFileSync(join(repo, pfad), inhalt);
};
const pruefen = (...args: string[]) => {
  const env = { ...process.env, GITHUB_EVENT_PATH: "", PR_REGELN_ERGEBNIS: "" };
  const lauf = spawnSync("bun", [SKRIPT, ...args], { cwd: repo, encoding: "utf8", env });
  return { code: lauf.status, ausgabe: lauf.stdout };
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "pr-regeln-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  datei("scripts/dateigroesse/altdateien.json", "[]\n");
  git("add", ".");
  git("commit", "-qm", "Basis");
  git("checkout", "-qb", "thema");
  datei("packages/core/src/neu.ts", "export const neu = 1;\n");
  git("add", ".");
  git("commit", "-qm", "fix: neu");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("pruefen.ts lokal", () => {
  it("meldet einen falschen Titel als Fehler und endet mit Code 1", () => {
    const { code, ausgabe } = pruefen("--basis", "main", "--titel", "feat: neu");
    expect(code).toBe(1);
    expect(ausgabe).toMatch(/^Fehler: Titel „feat: neu“: Conventional Commits/m);
  });

  it("prüft die Beschreibung aus der Datei", () => {
    datei("beschreibung.md", "Closes #12\n");
    const { code, ausgabe } = pruefen("--basis", "main", "--titel", "Kern: neue Konstante", "--beschreibung", "beschreibung.md");
    expect(code).toBe(1);
    expect(ausgabe).toMatch(/^Fehler: Beschreibung: „Closes #12“/m);
  });

  it("gibt Hinweise ohne Fehler aus und nennt den nicht geprüften Titel", () => {
    const { code, ausgabe } = pruefen("--basis", "main");
    expect(code).toBe(0);
    expect(ausgabe).toMatch(/^Hinweis: Code geändert, aber nichts in docs\//m);
    expect(ausgabe).toMatch(/^Hinweis: fix-Commit ohne geänderten Test/m);
    expect(ausgabe).toContain("Ohne --titel");
    expect(ausgabe).not.toContain("::");
  });

  it("erinnert lokal nicht an Selbstprüfung und Review", () => {
    expect(pruefen("--basis", "main", "--titel", "Kern: neue Konstante").ausgabe).not.toContain("beitrag-pruefen");
  });
});

describe("pruefen.ts: lange Seiten der Doku", () => {
  const woerter = (n: number) => `${"wort ".repeat(n)}\n`;

  beforeAll(() => {
    git("checkout", "-q", "main");
    datei("docs/lang.md", woerter(9000));
    datei("docs/alt.md", woerter(9000));
    git("add", ".");
    git("commit", "-qm", "Doku");
    git("checkout", "-qb", "doku");
  });

  it("weist auf eine Seite hin, die über 8.000 Wörter wächst", () => {
    datei("docs/neu.md", woerter(8100));
    git("add", ".");
    git("commit", "-qm", "Doku: neue Seite");
    expect(pruefen("--basis", "main").ausgabe).toMatch(/^Hinweis: docs\/neu\.md hat 8100 Wörter/m);
  });

  it("schweigt bei einer umbenannten langen Seite, die kaum wächst", () => {
    git("mv", "docs/alt.md", "docs/umbenannt.md");
    datei("docs/umbenannt.md", woerter(9010));
    git("add", ".");
    git("commit", "-qm", "Doku: Seite umbenannt");
    expect(pruefen("--basis", "main").ausgabe).not.toContain("docs/umbenannt.md");
  });
});

describe("pruefen.ts: mehrere umbenannte Seiten", () => {
  // eigener Inhalt je Seite, sonst paart git gleiche Seiten beliebig
  const woerter = (n: number, wort: string) => `${`${wort} `.repeat(n)}\n`;

  beforeAll(() => {
    git("checkout", "-q", "main");
    datei("docs/mit leer.md", woerter(9000, "leer"));
    datei("docs/eins.md", woerter(9000, "eins"));
    datei("docs/zwei.md", woerter(9000, "zwei"));
    git("add", ".");
    git("commit", "-qm", "Doku Randfälle");
    git("checkout", "-qb", "randfaelle");
  });

  it("schweigt bei Umbenennung einer Seite mit Leerzeichen und bei mehreren Umbenennungen", () => {
    git("mv", "docs/mit leer.md", "docs/ohne-leer.md");
    git("mv", "docs/eins.md", "docs/einsb.md");
    git("mv", "docs/zwei.md", "docs/zweib.md");
    git("commit", "-qm", "Doku: mehrere");
    const { ausgabe } = pruefen("--basis", "main");
    expect(ausgabe).not.toMatch(/docs\/(ohne-leer|einsb|zweib)\.md hat/);
  });
});
