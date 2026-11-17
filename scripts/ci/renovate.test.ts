import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Regel {
  matchPackageNames?: string[];
  groupName?: string;
  automerge?: boolean;
}

const regeln = (): Regel[] =>
  (Bun.JSON5.parse(readFileSync(new URL("../../.github/renovate.json5", import.meta.url), "utf8")) as { packageRules: Regel[] }).packageRules;

describe("Renovate", () => {
  it("gibt jeder Regel ohne Merge von selbst einen eigenen groupName", () => {
    // Die gemeinsame Einstellung (firsttris/workflows, renovate/default.json5) legt alle Minor- und Patch-Updates in die
    // Gruppe „dependencies (minor and patch)“, die sich bei grüner CI selbst merged. Ohne eigenen groupName bleibt ein
    // Paket in dieser Gruppe; Renovate merged eine Gruppe nur, wenn alle ihre Updates automerge haben
    // (generateBranchConfig: upgrades.every(automerge)). Dann wartete das ganze Monats-Update auf eine Person.
    const ohneGruppe = regeln()
      .filter((r) => r.automerge === false && r.matchPackageNames && !r.groupName)
      .map((r) => r.matchPackageNames!.join(", "));
    expect(ohneGruppe).toEqual([]);
  });
});
