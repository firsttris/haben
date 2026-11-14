import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILE_REFERENCES } from "../../apps/web/src/server/db/file-in-use.ts";

describe("Test-Restore", () => {
  it("zieht die Stichprobe der Dateien aus allen Tabellen mit Dateiverweis", () => {
    const script = readFileSync(new URL("./restore-check.sh", import.meta.url), "utf8");
    const liste = /^refs="([^"]*)"$/m.exec(script)?.[1]?.split(/\s+/).filter(Boolean);
    expect(liste?.sort()).toEqual(FILE_REFERENCES.map((r) => `${r.table}:${r.column}`).sort());
  });
});
