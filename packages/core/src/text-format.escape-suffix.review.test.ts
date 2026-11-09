import { describe, expect, it } from "vitest";
import { plainFormattedText } from "./text-format.ts";

describe("Maskierte Zeichen innerhalb eines Wortes", () => {
  it("wertet auch vor einem Suffix jedes ausdrücklich maskierte Zeichen aus", () => {
    expect(plainFormattedText("Variable \\_max\\_value")).toBe("Variable _max_value");
  });
});
