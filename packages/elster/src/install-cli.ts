/**
 * ERiC von der Kommandozeile installieren, z. B. im Container:
 *   node --experimental-strip-types packages/elster/src/install-cli.ts --lizenz-akzeptiert [Version]
 * Ziel ist ERIC_DIR (im Image /var/lib/haben/eric). Mit --nur-wenn-fehlt passiert nichts, wenn ERiC schon da ist.
 */
import { resolve } from "node:path";
import { DEFAULT_ERIC_VERSION, ERIC_INFO_URL, ericHomeIn, installedEricVersion, installEric } from "./install.ts";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const version = args.find((a) => !a.startsWith("--")) || process.env.ERIC_VERSION || DEFAULT_ERIC_VERSION;
const dir = resolve(process.env.ERIC_DIR || "data/eric");

if (!flags.has("--lizenz-akzeptiert")) {
  console.error(`ERiC steht unter den Nutzungsbedingungen der Finanzverwaltung (${ERIC_INFO_URL}).`);
  console.error("Mit --lizenz-akzeptiert stimmst du ihnen zu und Haben lädt ERiC herunter.");
  process.exit(2);
}
const existing = ericHomeIn(dir);
if (flags.has("--nur-wenn-fehlt") && existing) {
  console.log(`ERiC ${(await installedEricVersion(existing)) ?? ""} ist schon unter ${existing} eingerichtet.`);
  process.exit(0);
}

let lastShown = 0;
try {
  const result = await installEric({
    version,
    dir,
    baseUrl: process.env.ERIC_DOWNLOAD_URL || undefined,
    onProgress: (p) => {
      if (p.phase === "download" && p.bytes - lastShown >= 25 << 20) {
        lastShown = p.bytes;
        console.log(`  ${Math.round(p.bytes / 1048576)} MB${p.total ? ` von ${Math.round(p.total / 1048576)} MB` : ""}`);
      }
    },
  });
  console.log(`ERiC ${result.version} eingerichtet unter ${dir} (${result.files} Dateien).`);
} catch (error) {
  console.error(`ERiC konnte nicht eingerichtet werden: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
