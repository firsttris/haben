import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Norm } from "./normen.ts";
import { normenDatei } from "./normendatei.ts";

describe("normen.json schreiben", () => {
  it("erzeugt die eingecheckte Datei Zeichen für Zeichen, also im Format von Biome", () => {
    const eingecheckt = readFileSync(join(import.meta.dirname, "normen.json"), "utf8");
    const { normen } = JSON.parse(eingecheckt) as { normen: Norm[] };
    expect(normenDatei(normen)).toBe(eingecheckt);
  });
});
