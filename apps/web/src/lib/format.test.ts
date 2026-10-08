import { describe, expect, it } from "vitest";
import { parseUsefulLifeMonths } from "./format.ts";

describe("parseUsefulLifeMonths", () => {
  it("liest Jahre mit Komma oder Punkt", () => {
    expect(parseUsefulLifeMonths("3")).toBe(36);
    expect(parseUsefulLifeMonths("2,5")).toBe(30);
    expect(parseUsefulLifeMonths("2.5")).toBe(30);
  });

  it("lehnt Leeres, Null und angebrochene Monate ab", () => {
    expect(parseUsefulLifeMonths("")).toBeNull();
    expect(parseUsefulLifeMonths("0")).toBeNull();
    expect(parseUsefulLifeMonths("-1")).toBeNull();
    expect(parseUsefulLifeMonths("2,3")).toBeNull();
    expect(parseUsefulLifeMonths("abc")).toBeNull();
  });
});
