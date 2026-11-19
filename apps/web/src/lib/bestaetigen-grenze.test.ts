import { describe, expect, it } from "vitest";
import { BESTAETIGEN_HOECHSTENS, ersteMarkierbare, zuVieleMarkiert } from "./bestaetigen-grenze.ts";

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

  it("201 einzeln markierte Umsätze sind zu viele, 200 nicht", () => {
    expect(zuVieleMarkiert(BESTAETIGEN_HOECHSTENS)).toBe(false);
    expect(zuVieleMarkiert(BESTAETIGEN_HOECHSTENS + 1)).toBe(true);
  });
});
