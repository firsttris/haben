import { describe, expect, it } from "vitest";
import { likePattern } from "./search.ts";

describe("likePattern", () => {
  it("maskiert % und _ und Backslash", () => {
    expect(likePattern("100% _test\\x")).toBe("%100\\% \\_test\\\\x%");
  });
});
