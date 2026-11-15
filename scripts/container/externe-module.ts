/*
 * Prüft im fertigen Image, dass alle Pakete da sind, die zur Laufzeit geladen werden (CI-Job container). Das
 * Laufzeit-Image installiert nur die Laufzeitabhängigkeiten ohne Peers (Containerfile); fehlt eines, fiele das sonst
 * erst beim Nutzer auf, etwa bei der ersten Übermittlung an ELSTER. Zwei Teile:
 * - das Server-Bundle und der Befehl haben: jedes Paket, das sie von außen importieren, wird geladen;
 * - die Skripte, die Bun aus den Quellen ausführt (Migrationen, ERiC-Worker und -Installation, SSO-Übernahme): Bun
 *   löst sie samt allen Importen auf, ohne sie auszuführen.
 * Aufruf im Container: bun /tmp/externe-module.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const BUNDLE = "/app/apps/web/.output/server";
/** Der Befehl haben, gebaut mit --packages external (Containerfile) */
const CLI = "/app/apps/web/.output/haben-cli.js";
const SKRIPTE = [
  "/app/apps/web/src/server/db/migrate.ts",
  "/app/apps/web/src/server/db/sso-uebernahme.ts",
  "/app/packages/elster/src/worker.ts",
  "/app/packages/elster/src/install-cli.ts",
];

const builtin = new Set(builtinModules);
const transpiler = new Bun.Transpiler({ loader: "js" });
let fehler = 0;

function* dateien(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* dateien(path);
    else if (/\.[cm]?js$/.test(entry.name)) yield path;
  }
}

const pakete = new Map<string, string>();
for (const datei of [...dateien(BUNDLE), CLI]) {
  for (const { path } of transpiler.scanImports(readFileSync(datei, "utf8"))) {
    if (/^[./#]/.test(path) || path.includes(":") || builtin.has(path) || pakete.has(path)) continue;
    pakete.set(path, datei);
  }
}
if (pakete.size === 0) {
  console.error(`Keine externen Importe unter ${BUNDLE}; stimmt der Pfad?`);
  fehler++;
}
for (const [name, datei] of pakete) {
  try {
    await import(Bun.resolveSync(name, datei));
    console.log(`ok     Bundle: ${name}`);
  } catch (error) {
    fehler++;
    console.log(`FEHLT  Bundle: ${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

for (const skript of SKRIPTE) {
  // packages: "bundle" löst jedes Paket bis in die letzte Datei auf; das Ergebnis bleibt im Speicher
  const ergebnis = await Bun.build({ entrypoints: [skript], target: "bun", packages: "bundle", throw: false });
  if (ergebnis.success) {
    console.log(`ok     Skript: ${skript}`);
  } else {
    fehler++;
    console.log(`FEHLT  Skript: ${skript}`);
    for (const log of ergebnis.logs) console.log(`         ${log.message}`);
  }
}

process.exit(fehler > 0 ? 1 : 0);
