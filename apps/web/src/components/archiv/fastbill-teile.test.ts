import { describe, expect, it } from "vitest";
import { fastbillUsageText } from "./FastbillTeile.tsx";

describe("fastbillUsageText", () => {
  it("schreibt bei genau einer freien Anfrage „1 ist noch frei“", () => {
    expect(fastbillUsageText({ used: 49, freeAt: "2026-11-19T14:40:00Z" }, 50)).toMatch(/49 davon genutzt, 1 ist noch frei\./);
  });

  it("rechnet die Uhrzeit auch in der Sommerzeit nach deutscher Zeit", () => {
    expect(fastbillUsageText({ used: 50, freeAt: "2026-07-01T10:05:00Z" }, 50)).toMatch(/um 12:05 Uhr frei\./);
  });

  it("nennt genutzte und freie Anfragen und, wenn keine frei ist, wann die nächste frei wird", () => {
    expect(fastbillUsageText({ used: 0, freeAt: null }, 50)).toBe("");
    expect(fastbillUsageText({ used: 12, freeAt: "2026-11-19T14:40:00Z" }, 50)).toMatch(/12 davon genutzt, 38 sind noch frei\./);
    expect(fastbillUsageText({ used: 50, freeAt: "2026-11-19T14:40:00Z" }, 50)).toMatch(
      /50 davon genutzt, 0 sind noch frei, die nächste wird um 15:40 Uhr frei\./,
    );
  });
});
