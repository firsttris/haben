import { describe, expect, it } from "vitest";
import { arbeit, type IssueKurz } from "./vorab.ts";

const issue = (number: number, teil: Partial<IssueKurz> = {}): IssueKurz => ({ number, author: "anna", labels: [], kommentarVon: [], ...teil });

describe("arbeit", () => {
  it("findet neue Issues ohne Karte und ohne Antwort", () => {
    const ergebnis = arbeit([issue(1), issue(2), issue(3, { kommentarVon: ["github-actions[bot]"] })], new Set([2]));
    expect(ergebnis.ohneKarte).toEqual([1]);
  });

  it("zählt eigene Issues ohne Karte mit, beantwortete und Sammel-Issues aber nicht", () => {
    const ergebnis = arbeit(
      [
        issue(1, { author: "firsttris" }),
        issue(2, { kommentarVon: ["firsttris"] }),
        issue(3, { labels: ["board-pflege"] }),
        issue(4, { author: "app/renovate" }),
      ],
      new Set(),
    );
    expect(ergebnis.ohneKarte).toEqual([1]);
  });

  it("findet Gespräche, in denen zuletzt jemand anderes geschrieben hat", () => {
    const ergebnis = arbeit(
      [
        issue(1, { kommentarVon: ["firsttris", "bert"] }),
        issue(2, { kommentarVon: ["bert", "firsttris"] }),
        issue(3, { kommentarVon: ["bert", "github-actions[bot]"] }),
      ],
      new Set([1, 2, 3]),
    );
    expect(ergebnis.gespraeche).toEqual([1]);
  });

  it("meldet nichts, wenn alles beantwortet ist", () => {
    expect(arbeit([issue(1, { kommentarVon: ["firsttris"] })], new Set([1]))).toEqual({ ohneKarte: [], gespraeche: [] });
  });
});
