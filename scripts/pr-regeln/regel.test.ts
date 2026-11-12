import { describe, expect, it } from "vitest";
import { checkBody, checkTitle, growthHints, hints, isBot, reviewHint } from "./regel.ts";

describe("checkTitle", () => {
  it.each([
    "Belege: Gestaltung in Vorschau und Einstellungen (#113)",
    "E-Rechnung: Artikelnummer in der Position, im PDF und als BT-155 (#388)",
    "ELSTER: ERiC auf arm64 über einen Worker-Befehl unter QEMU",
    "Doku-Bilder: Daten für die Bilder legt der Doku-Test selbst an",
    "Lohn und Gehalt: Bescheinigung 2026",
    "sevDesk: Belege mit Anhängen übernehmen",
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

describe("growthHints", () => {
  it("weist auf deutlich gewachsene alte Dateien hin, nur als Warnung", () => {
    expect(growthHints([{ file: "apps/web/src/routes/_app/bank.tsx", before: 1513, after: 1561 }])).toEqual([
      { level: "warning", message: expect.stringContaining("von 1513 auf 1561 Zeilen") },
    ]);
  });

  it("schweigt bei kleinem Wachstum und bei schema.ts, die wachsen muss", () => {
    expect(
      growthHints([
        { file: "apps/web/src/routes/_app/bank.tsx", before: 1513, after: 1532 },
        { file: "apps/web/src/server/db/schema.ts", before: 2879, after: 3002 },
      ]),
    ).toEqual([]);
  });
});

describe("isBot", () => {
  it("erkennt Renovate und andere Bots", () => {
    expect(isBot({ login: "renovate[bot]", type: "Bot" })).toBe(true);
    expect(isBot({ login: "renovate[bot]" })).toBe(true);
    expect(isBot({ login: "Dudeplayz", type: "User" })).toBe(false);
  });
});

describe("checkBody", () => {
  it("lässt Refs und Umgesetzt durch", () => {
    expect(checkBody("Refs #12\n\nUmgesetzt #13")).toEqual([]);
    expect(checkBody(null)).toEqual([]);
  });

  it("meldet Closes und Fixes als Fehler, weil sie schon beim Merge schließen", () => {
    const reports = checkBody("Closes #12\nfixes #13");
    expect(reports).toHaveLength(2);
    expect(reports.every(({ level }) => level === "error")).toBe(true);
    expect(reports[0].message).toContain("Umgesetzt #");
  });

  it("lässt Beispiele in Code durch", () => {
    expect(checkBody("Nicht `Closes #12`, sondern Umgesetzt #12")).toEqual([]);
  });
});

describe("reviewHint", () => {
  const fremd = { draft: false, author_association: "CONTRIBUTOR", user: { login: "TheLord83", type: "User" } };

  it("erinnert bei einem fremden Pull Request mit Code an beitrag-pruefen und tdd-review", () => {
    const [report] = reviewHint(fremd, ["apps/web/src/server/modules/bank/index.ts", "docs/bank.md"]);
    expect(report.level).toBe("warning");
    expect(report.message).toContain("`beitrag-pruefen`");
    expect(report.message).toContain("`tdd-review`");
    expect(report.message).not.toContain("`doku-pruefen`");
  });

  it("nennt doku-pruefen, wenn nur Markdown, docs/ oder LICENSE geändert sind", () => {
    const [report] = reviewHint({ ...fremd, author_association: "FIRST_TIME_CONTRIBUTOR" }, ["docs/ki-assistenten.md", "README.md"]);
    expect(report.message).toContain("`beitrag-pruefen`");
    expect(report.message).toContain("`doku-pruefen`");
    expect(report.message).not.toContain("`tdd-review`");
  });

  it.each(["OWNER", "MEMBER", "COLLABORATOR"])("schweigt bei %s", (author_association) => {
    expect(reviewHint({ ...fremd, author_association }, ["docs/bank.md"])).toEqual([]);
  });

  it("schweigt bei Entwürfen und Bots", () => {
    expect(reviewHint({ ...fremd, draft: true }, ["docs/bank.md"])).toEqual([]);
    expect(reviewHint({ ...fremd, user: { login: "renovate[bot]", type: "Bot" } }, ["package.json"])).toEqual([]);
  });
});
