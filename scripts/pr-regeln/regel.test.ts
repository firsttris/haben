import { describe, expect, it } from "vitest";
import { checkAgentMarker, checkTitle, hints, isAgentCommit } from "./regel.ts";

describe("checkTitle", () => {
  it.each([
    "Belege: Gestaltung in Vorschau und Einstellungen (#113)",
    "E-Rechnung: Artikelnummer in der Position, im PDF und als BT-155 (#388)",
    "ELSTER: ERiC auf arm64 über einen Worker-Befehl unter QEMU",
    "Doku-Bilder: Daten für die Bilder legt der Doku-Test selbst an",
    "Lohn und Gehalt: Bescheinigung 2026",
  ])("lässt „%s“ durch", (title) => {
    expect(checkTitle(title)).toEqual([]);
  });

  it.each([
    "Aktualisieren von README.md",
    "Entwürfe als PDF mit Vermerk ENTWURF über jeder Seite",
    "app.spec.ts aufteilen: drei Durchläufe",
    "Belege:ohne Leerzeichen",
    "Belege: ",
  ])("meldet „%s“", (title) => {
    expect(checkTitle(title)).toHaveLength(1);
  });

  it("erklärt bei Conventional Commits im Titel den Unterschied", () => {
    const [report] = checkTitle("docs: Dokumentation mit Zensical bauen");
    expect(report.message).toContain("Conventional Commits gelten für Commits");
  });

  it("meldet einen Punkt am Ende", () => {
    expect(checkTitle("Bank: Umsätze abrufen.")[0].message).toContain("ohne Punkt");
  });
});

describe("checkAgentMarker", () => {
  const agent = "feat(belege): Split\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
  const human = "fix: Tippfehler\n\nCo-Authored-By: Erika Muster <erika@example.org>";

  it("erkennt Commits von Agenten am Co-Authored-By", () => {
    expect(isAgentCommit(agent)).toBe(true);
    expect(isAgentCommit("feat: x\n\nCo-authored-by: GitHub Copilot <copilot@github.com>")).toBe(true);
    expect(isAgentCommit(human)).toBe(false);
    expect(isAgentCommit("docs: Claude in der Doku erwähnt")).toBe(false);
  });

  it("verlangt die Zeile „Generated with“, wenn ein Agent mitgeschrieben hat", () => {
    expect(checkAgentMarker("Was und warum", [human, agent])).toHaveLength(1);
    expect(checkAgentMarker("Was und warum\n\n🤖 Generated with [Claude Code](…)", [agent])).toEqual([]);
  });

  it("verlangt nichts ohne Commits von Agenten", () => {
    expect(checkAgentMarker("", [human])).toEqual([]);
  });
});

describe("hints", () => {
  it("weist auf Code ohne Doku hin", () => {
    const reports = hints(["apps/web/src/server/modules/bank/bank.ts"], ["feat(bank): x"]);
    expect(reports.map((r) => r.message)).toEqual([expect.stringContaining("nichts in docs/")]);
  });

  it("schweigt, wenn die Doku mitkommt oder nur Tests geändert sind", () => {
    expect(hints(["packages/core/src/ust.ts", "docs/umsatzsteuer.md"], ["feat: x"])).toEqual([]);
    expect(hints(["packages/core/src/ust.test.ts"], ["test: x"])).toEqual([]);
  });

  it("weist auf einen fix-Commit ohne Test hin", () => {
    const reports = hints(["docs/bank.md"], ["fix(bank): Datum"]);
    expect(reports.map((r) => r.message)).toEqual([expect.stringContaining("Bugfix beginnt mit einem Test")]);
    expect(hints(["apps/web/e2e/bank.spec.ts", "docs/bank.md"], ["fix(bank): Datum"])).toEqual([]);
  });
});
