import { describe, expect, it } from "vitest";
import { normalizeSenders, senderAllowed } from "./inbox-absender.ts";

describe("Absenderfreigabe", () => {
  it("lässt bei leerer Liste jeden zu, auch ohne Adresse", () => {
    expect(senderAllowed("x@y.example", [])).toBe(true);
    expect(senderAllowed(undefined, [])).toBe(true);
  });

  it("vergleicht Adresse und Domain ohne Groß- und Kleinschreibung", () => {
    const list = normalizeSenders(["Rechnung@Lieferant.example", "@Shop.example", "kunde.example"]);
    expect(senderAllowed("RECHNUNG@lieferant.example", list)).toBe(true);
    expect(senderAllowed("andere@lieferant.example", list)).toBe(false);
    expect(senderAllowed("x@shop.example", list)).toBe(true);
    expect(senderAllowed("x@kunde.example", list)).toBe(true);
    expect(senderAllowed("x@sub.kunde.example", list)).toBe(false);
    expect(senderAllowed("x@meinkunde.example", list)).toBe(false);
  });

  it("weist Mails ohne brauchbare Absenderadresse ab", () => {
    expect(senderAllowed("", ["a.example"])).toBe(false);
    expect(senderAllowed(undefined, ["a.example"])).toBe(false);
    expect(senderAllowed("ohne-at", ["a.example"])).toBe(false);
  });

  it("räumt die Liste auf", () => {
    expect(normalizeSenders([" A@B.example ", "a@b.example", "", "<c@d.example>"])).toEqual(["a@b.example", "c@d.example"]);
  });
});
