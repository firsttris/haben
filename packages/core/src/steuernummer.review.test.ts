import { describe, expect, it } from "vitest";
import { SteuernummerError, toElsterSteuernummer } from "./steuernummer.ts";

describe("Review toElsterSteuernummer", () => {
  it("13-stellige Brandenburger Nummer (30FF) passt nicht zu Sachsen (32FF)", () => {
    expect(() => toElsterSteuernummer("3046081508159", "SN")).toThrow(SteuernummerError);
  });

  it("13-stellige Thüringer Nummer (41FF) passt nicht zu Mecklenburg-Vorpommern (40FF)", () => {
    expect(() => toElsterSteuernummer("4151081508156", "MV")).toThrow(SteuernummerError);
  });
});
