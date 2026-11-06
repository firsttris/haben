import { describe, expect, it } from "vitest";
import { sammelHinweise, teileHinweise } from "./hinweise.ts";

describe("sammelHinweise", () => {
  it("nummeriert nur Begründungen, die mehrfach vorkommen, in der Reihenfolge ihres ersten Auftretens", () => {
    const hinweise = sammelHinweise(["Alle offenen Rechnungen", "Sofort fällig", "Darlehen", "Sofort fällig", "Darlehen", "Sofort fällig"]);
    expect([...hinweise]).toEqual([
      ["Sofort fällig", 1],
      ["Darlehen", 2],
    ]);
    expect(hinweise.has("Alle offenen Rechnungen")).toBe(false);
  });

  it("ohne Wiederholung keine Hinweise", () => {
    expect(sammelHinweise(["a", "b"]).size).toBe(0);
    expect(sammelHinweise([]).size).toBe(0);
  });
});

describe("teileHinweise", () => {
  const jahr = { text: "Das Jahr 2026 ist noch nicht vorbei." };
  const afa = { text: "AfA 2026 fehlt für eine Anlage." };
  const anteilseigner = { text: "Die Anteilseigner fehlen." };
  const gegenstand = { text: "Der Gegenstand des Unternehmens fehlt." };

  it("zieht gleich lautende Hinweise heraus und lässt die eigenen in ihrer Reihenfolge", () => {
    expect(teileHinweise([jahr, anteilseigner, afa], [gegenstand, afa, jahr])).toEqual({
      gemeinsam: [jahr, afa],
      nurA: [anteilseigner],
      nurB: [gegenstand],
    });
  });

  it("ohne Überschneidung bleibt alles bei seiner Erklärung", () => {
    expect(teileHinweise([anteilseigner], [gegenstand])).toEqual({ gemeinsam: [], nurA: [anteilseigner], nurB: [gegenstand] });
  });
});
