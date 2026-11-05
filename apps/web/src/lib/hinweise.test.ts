import { describe, expect, it } from "vitest";
import { sammelHinweise } from "./hinweise.ts";

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
