import { ladeKonfiguration } from "./env.ts";
import { ladeLogos } from "./logos.ts";
import { portal } from "./server.ts";

/* Startet das Firmenportal (#504) mit Bun; ohne gültige Konfiguration startet es nicht und nennt die Variablen. */

const ergebnis = ladeKonfiguration(process.env);
if ("fehler" in ergebnis) {
  console.error(`Firmenportal: Konfiguration ungültig\n${ergebnis.fehler.map((zeile) => `  ${zeile}`).join("\n")}`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
type Server = { requestIP: (request: Request) => { address: string } | null };
type Serve = (options: { port: number; fetch: (request: Request, server: Server) => Promise<Response> }) => unknown;
const runtime = globalThis as unknown as { Bun: { serve: Serve } };
// Logos einmal beim Start; nach einer Änderung startet man das Firmenportal neu wie nach einer an PORTAL_FIRMEN
const logos = await ladeLogos(ergebnis.config.logos, ergebnis.config.firmen, (text) => console.error(text));
const handler = portal(ergebnis.config, Date.now, logos);
// Die Adresse der Verbindung zählt für die Begrenzung der Anmeldewege nur ohne X-Forwarded-For (grenze.ts)
runtime.Bun.serve({ port, fetch: (request, server) => handler(request, server.requestIP(request)?.address) });
console.log(`Firmenportal: ${ergebnis.config.firmen.length} Firmen, ${logos.size} Logos, ${ergebnis.config.url} (Port ${port})`);
