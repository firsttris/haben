import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hatJahresPlugin } from "./eric-plugins.ts";

describe("Prüf-Plugins im ERiC-Paket", () => {
  // Wie ERiC 44.3: Plugins für Bilanz_6_9 und UStVA_2026, keins für die Taxonomie 6.10
  const home = mkdtempSync(join(tmpdir(), "eric-plugins-"));
  mkdirSync(join(home, "lib", "plugins"), { recursive: true });
  for (const plugin of ["libcheckBilanz_6_9.so", "libcheckUStVA_2026.so"]) writeFileSync(join(home, "lib", "plugins", plugin), "");
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("Taxonomien der E-Bilanz: Bilanz_6.10 braucht libcheckBilanz_6_10.so", () => {
    expect(hatJahresPlugin(home, "Bilanz_6.9")).toBe(true);
    expect(hatJahresPlugin(home, "Bilanz_6.10")).toBe(false);
  });

  it("Jahresversionen und Datenarten ohne Version", () => {
    expect(hatJahresPlugin(home, "UStVA_2026")).toBe(true);
    expect(hatJahresPlugin(home, "UStVA_2027")).toBe(false);
    expect(hatJahresPlugin(home, "ZMDO")).toBe(true);
    expect(hatJahresPlugin(home, undefined)).toBe(true);
  });
});
