import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INTERNAL_PROVIDERS } from "@haben/import";
import { describe, expect, it } from "vitest";

/*
 * INTERNAL_PROVIDERS fällt offen aus: Fehlt eine Anbindung, nimmt der REST-Import Lieferungen in ihre Quelle an
 * (#306; PayPal und Stripe wurden so schon vergessen). Jede Anbindung bindet ihre Quelle mit einem festen Anbieter
 * an `storeBatch` (`binding: { provider: "…" }`); hier wird jede solche Stelle im Code gegen die Liste geprüft.
 */

const modules = fileURLToPath(new URL("..", import.meta.url));

/** Anbieter aus `binding: { provider: "…"` in allen Dateien unter server/modules außer Tests */
function gebundeneAnbieter(): Map<string, string[]> {
  const gefunden = new Map<string, string[]>();
  for (const datei of readdirSync(modules, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(datei) || /\.test\.tsx?$/.test(datei)) continue;
    const code = readFileSync(join(modules, datei), "utf8");
    for (const [, provider] of code.matchAll(/binding:\s*\{\s*provider:\s*"([^"]+)"/g)) {
      gefunden.set(provider!, [...(gefunden.get(provider!) ?? []), datei]);
    }
  }
  return gefunden;
}

describe("Interne Anbieter (#306)", () => {
  it("jede Anbindung in Haben steht in INTERNAL_PROVIDERS", () => {
    const gefunden = gebundeneAnbieter();
    // Die Suche selbst greift: die bekannten Abrufe werden gefunden
    expect([...gefunden.keys()]).toEqual(expect.arrayContaining(["enablebanking", "etsy", "paypal", "stripe"]));
    const fehlend = [...gefunden].filter(([provider]) => !(INTERNAL_PROVIDERS as readonly string[]).includes(provider));
    expect(Object.fromEntries(fehlend)).toEqual({});
  });
});
