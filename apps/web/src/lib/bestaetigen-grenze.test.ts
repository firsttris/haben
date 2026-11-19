import { describe, expect, it } from "vitest";
import { BESTAETIGEN_HOECHSTENS, ersteMarkierbare, umschalten } from "./bestaetigen-grenze.ts";

describe("Grenze der Sammelbestätigung (#1440)", () => {
  it("Alle markieren setzt bei mehr Vorschlägen als erlaubt genau die ersten 200", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `u${i}`);
    const markiert = ersteMarkierbare(ids);
    expect(markiert).toHaveLength(BESTAETIGEN_HOECHSTENS);
    expect(markiert[0]).toBe("u0");
    expect(markiert.at(-1)).toBe("u199");
  });

  it("bei wenigen Vorschlägen werden alle markiert", () => {
    expect(ersteMarkierbare(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("ein einzelner Haken schaltet um", () => {
    const an = umschalten(new Set(["a"]), "b");
    expect([...an.markiert]).toEqual(["a", "b"]);
    expect(an.voll).toBe(false);
    expect([...umschalten(an.markiert, "a").markiert]).toEqual(["b"]);
  });

  it("der 201. Haken von Hand wird abgelehnt, Wegnehmen geht immer", () => {
    const voll = new Set(Array.from({ length: BESTAETIGEN_HOECHSTENS }, (_, i) => `u${i}`));
    const abgelehnt = umschalten(voll, "u200");
    expect(abgelehnt.voll).toBe(true);
    expect(abgelehnt.markiert.size).toBe(BESTAETIGEN_HOECHSTENS);
    expect(abgelehnt.markiert.has("u200")).toBe(false);
    const weniger = umschalten(voll, "u0");
    expect(weniger.voll).toBe(false);
    expect(weniger.markiert.size).toBe(BESTAETIGEN_HOECHSTENS - 1);
  });
});
