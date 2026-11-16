import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./release-notes.ts";

describe("Versionsvergleich (#1239)", () => {
  it.each([
    ["1.2.4", "1.2.3", true],
    ["1.10.0", "1.9.9", true],
    ["2.0.0", "1.99.99", true],
    ["1.2.3", "1.2.3", false],
    ["1.2.3", "1.2.4", false],
    ["1.2.3", "1.2.3-rc.2", true],
    ["1.2.3-rc.2", "1.2.3", false],
    ["1.3.0", "1.2.3-rc.1", true],
    ["1.2.3", "1.3.0-rc.1", false],
    ["1.2.3", "dev", false],
    ["1.2.3-rc.3", "1.2.3-rc.2", true],
    ["1.2.3-rc.10", "1.2.3-rc.9", true],
    ["1.2.3-rc.2", "1.2.3-rc.10", false],
    ["v1.2.4", "1.2.3", true],
  ])("%s gegen installiert %s: neuer = %s", (latest, installed, expected) => {
    expect(isNewerVersion(latest, installed)).toBe(expected);
  });
});
