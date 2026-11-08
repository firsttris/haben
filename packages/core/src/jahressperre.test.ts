import { describe, expect, it } from "vitest";
import { fehlendeJahre } from "./jahressperre.ts";

describe("fehlendeJahre", () => {
  it("verlangt das laufende Jahr, ab Dezember auch das folgende", () => {
    expect(fehlendeJahre(new Date("2026-11-15T12:00:00Z"), [])).toEqual([2026]);
    expect(fehlendeJahre(new Date("2026-12-15T12:00:00Z"), [2026])).toEqual([2027]);
  });
  it("Monats- und Jahreswechsel nach deutscher Zeit, unabhängig von der Zeitzone des Prozesses", () => {
    // 30.11.2026 23:30 UTC ist in Deutschland schon der 1. Dezember
    expect(fehlendeJahre(new Date("2026-11-30T23:30:00Z"), [2026])).toEqual([2027]);
    // 31.12.2026 23:30 UTC ist schon 2027, und Dezember ist vorbei
    expect(fehlendeJahre(new Date("2026-12-31T23:30:00Z"), [2026])).toEqual([2027]);
  });
});
