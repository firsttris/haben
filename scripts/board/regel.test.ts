import { describe, expect, it } from "vitest";
import { istFertigeVersion, kommentar, schliessendeStichwoerter, schritte, verweise, vorigeFertigeVersion, zielStatus, zuSchliessen } from "./regel.ts";

describe("verweise", () => {
  it("trennt Refs und Umgesetzt", () => {
    expect(verweise("Refs #12\n\nUmgesetzt #13")).toEqual({ refs: [12], umgesetzt: [13] });
  });

  it("liest Listen mit Komma und „und“", () => {
    expect(verweise("Umgesetzt #1, #2 und #3\nRefs #4, #5")).toEqual({ refs: [4, 5], umgesetzt: [1, 2, 3] });
  });

  it("zählt ein Issue mit Refs und Umgesetzt nur als umgesetzt", () => {
    expect(verweise("Refs #7\nUmgesetzt #7")).toEqual({ refs: [], umgesetzt: [7] });
  });

  it("ignoriert Beispiele in Code", () => {
    expect(verweise("Mit `Umgesetzt #123` heißt es fertig.\n```\nRefs #9\n```\nRefs #10")).toEqual({
      refs: [10],
      umgesetzt: [],
    });
  });

  it("verlangt das Stichwort vor der Nummer", () => {
    expect(verweise("Wie in #12 besprochen, umgesetzt ist es noch nicht")).toEqual({ refs: [], umgesetzt: [] });
  });

  it("nimmt einen Doppelpunkt hin und ignoriert Groß- und Kleinschreibung", () => {
    expect(verweise("umgesetzt: #5\nREFS #6")).toEqual({ refs: [6], umgesetzt: [5] });
  });
});

describe("schliessendeStichwoerter", () => {
  it.each(["Closes #1", "fixes #2", "Resolved: #3", "close firsttris/haben#4", "Fixed #5"])("findet „%s“", (text) => {
    expect(schliessendeStichwoerter(text)).toHaveLength(1);
  });

  it.each(["Refs #1", "Umgesetzt #2", "Fixkosten #3", "Mit `Closes #4` schlösse GitHub das Issue", "closes the dialog"])("lässt „%s“ durch", (text) => {
    expect(schliessendeStichwoerter(text)).toEqual([]);
  });
});

describe("zielStatus", () => {
  it("rückt nach rechts", () => {
    expect(zielStatus("Geplant", "In Arbeit")).toBe("In Arbeit");
    expect(zielStatus("In Arbeit", "Im nächsten Release")).toBe("Im nächsten Release");
  });

  it("setzt eine Karte ohne Status", () => {
    expect(zielStatus(null, "Im nächsten Release")).toBe("Im nächsten Release");
  });

  it("rückt nie zurück und bleibt, wo sie ist", () => {
    expect(zielStatus("Im nächsten Release", "In Arbeit")).toBeNull();
    expect(zielStatus("Erledigt", "Im nächsten Release")).toBeNull();
    expect(zielStatus("In Arbeit", "In Arbeit")).toBeNull();
  });
});

describe("schritte", () => {
  const pr = (action: string, body: string, merged = false, state = "open") => ({
    art: "pull_request" as const,
    action,
    pull_request: { body, merged, state },
  });

  it("Zuweisung schiebt die Karte nach In Arbeit, ohne sie anzulegen", () => {
    expect(schritte({ art: "issues", action: "assigned", issue: { number: 5 } })).toEqual([{ issue: 5, ziel: "In Arbeit", hinzufuegen: false }]);
  });

  it("andere Ereignisse an Issues und Zuweisungen an PRs ändern nichts", () => {
    expect(schritte({ art: "issues", action: "labeled", issue: { number: 5 } })).toEqual([]);
    expect(schritte({ art: "issues", action: "assigned", issue: { number: 5, pull_request: {} } })).toEqual([]);
  });

  it("ein geöffneter PR schiebt alle seine Issues nach In Arbeit", () => {
    expect(schritte(pr("opened", "Refs #1\nUmgesetzt #2"))).toEqual([
      { issue: 2, ziel: "In Arbeit", hinzufuegen: false },
      { issue: 1, ziel: "In Arbeit", hinzufuegen: false },
    ]);
  });

  it("ein gemergter PR schiebt nur Umgesetzt weiter und legt fehlende Karten an", () => {
    expect(schritte(pr("closed", "Refs #1\nUmgesetzt #2", true, "closed"))).toEqual([{ issue: 2, ziel: "Im nächsten Release", hinzufuegen: true }]);
  });

  it("ein geschlossener, nicht gemergter PR ändert nichts", () => {
    expect(schritte(pr("closed", "Umgesetzt #2", false, "closed"))).toEqual([]);
  });

  it("eine Änderung an einem geschlossenen PR ändert nichts", () => {
    expect(schritte(pr("edited", "Umgesetzt #2", true, "closed"))).toEqual([]);
  });
});

describe("Release", () => {
  it("schließt nur bei einer fertigen Version", () => {
    expect(istFertigeVersion("v0.7.0")).toBe(true);
    expect(istFertigeVersion("v0.7.0-rc.1")).toBe(false);
  });

  it("findet die vorige fertige Version und überspringt Release Candidates", () => {
    const tags = ["v0.6.5", "v0.6.6", "v0.7.0-rc.1", "v0.7.0-rc.2", "v0.7.0", "v0.10.0"];
    expect(vorigeFertigeVersion(tags, "v0.7.0")).toBe("v0.6.6");
    expect(vorigeFertigeVersion(tags, "v0.10.0")).toBe("v0.7.0");
    expect(vorigeFertigeVersion(["v0.7.0"], "v0.7.0")).toBeNull();
  });

  it("sammelt umgesetzte Issues mit ihren Pull Requests aus den Squash-Commits", () => {
    const commits = [
      "Steuern: Dezember-Vorauszahlung dem Vorjahr zuordnen (#630)\n\nUmgesetzt #583",
      "Belege: Teil 1 (#631)\n\nRefs #113",
      "Belege: Rest (#640)\n\nUmgesetzt #583, #587",
      "Release v0.7.0",
    ];
    expect(zuSchliessen(commits)).toEqual(
      new Map([
        [583, [630, 640]],
        [587, [640]],
      ]),
    );
  });

  it("schreibt den Kommentar mit Version, Pull Requests und Weg zum neuen Issue", () => {
    const text = kommentar("firsttris/haben", "v0.7.0", 583, [630]);
    expect(text).toContain("[v0.7.0](https://github.com/firsttris/haben/releases/tag/v0.7.0)");
    expect(text).toContain("umgesetzt in #630");
    expect(text).toContain("neues Issue");
    expect(text).toContain("(#583)");
  });
});
