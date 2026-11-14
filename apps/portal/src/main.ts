import { ladeKonfiguration } from "./env.ts";
import { portal } from "./server.ts";

/* Startet das Portal (#504) mit Bun; ohne gültige Konfiguration startet es nicht und nennt die Variablen. */

const ergebnis = ladeKonfiguration(process.env);
if ("fehler" in ergebnis) {
  console.error(`Portal: Konfiguration ungültig\n${ergebnis.fehler.map((zeile) => `  ${zeile}`).join("\n")}`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
const runtime = globalThis as unknown as { Bun: { serve: (options: { port: number; fetch: (request: Request) => Promise<Response> }) => unknown } };
runtime.Bun.serve({ port, fetch: portal(ergebnis.config) });
console.log(`Portal: ${ergebnis.config.firmen.length} Firmen, ${ergebnis.config.url} (Port ${port})`);
