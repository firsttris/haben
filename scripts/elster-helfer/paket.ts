/*
 * Baut die Erweiterung „Haben für Mein ELSTER“ (apps/elster-helfer, TypeScript mit Vite) und packt sie für ein Release:
 *   bun scripts/elster-helfer/paket.ts <tag> <ausgabeordner>
 * Das ZIP heißt wie bei den anderen Erweiterungen <name>-chrome-<version>.zip und hat manifest.json im
 * Hauptverzeichnis; so nimmt es auch der Chrome Web Store (browser-extension-stores.yml in firsttris/workflows).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "haben-fuer-mein-elster";
const TAG = /^v(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** Version ohne v; wirft bei einem Tag, der keine Version ist */
function versionAus(tag: string): { full: string; numeric: string } {
  const match = TAG.exec(tag);
  if (!match?.[1]) throw new Error(`Tag ${tag} ist keine Version vX.Y.Z`);
  return { full: tag.slice(1), numeric: match[1] };
}

/**
 * Manifest mit der Version des Releases. Chrome nimmt in `version` nur Zahlen mit Punkt; bei einem Release Candidate
 * steht die volle Bezeichnung deshalb in `version_name` (developer.chrome.com, Manifest „version“ und „version_name“).
 */
export function releaseManifest(manifest: Record<string, unknown>, tag: string): Record<string, unknown> {
  const { full, numeric } = versionAus(tag);
  return full === numeric ? { ...manifest, version: numeric } : { ...manifest, version: numeric, version_name: full };
}

export function paketName(tag: string): string {
  return `${NAME}-chrome-${versionAus(tag).full}.zip`;
}

/** Baut die Erweiterung mit Vite nach dist/ und gibt den Ordner zurück */
function bauen(projekt: string): string {
  execFileSync(process.execPath, ["run", "build"], { cwd: projekt, stdio: ["ignore", "ignore", "inherit"] });
  return join(projekt, "dist");
}

/** Kopiert die gebaute Erweiterung in einen leeren Ordner, setzt die Version und packt sie; gibt den Pfad des ZIPs zurück */
function packen(quelle: string, tag: string, ausgabe: string): string {
  const arbeit = mkdtempSync(join(tmpdir(), "haben-erweiterung-"));
  try {
    cpSync(quelle, arbeit, { recursive: true });
    const manifestPfad = join(arbeit, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPfad, "utf8")) as Record<string, unknown>;
    writeFileSync(manifestPfad, `${JSON.stringify(releaseManifest(manifest, tag), null, 2)}\n`);
    const zip = resolve(ausgabe, paketName(tag));
    // zip -r ergänzt ein vorhandenes Archiv nur; ein ZIP aus einem früheren Lauf brächte alte Dateien mit
    rmSync(zip, { force: true });
    // -X ohne Zusatzattribute, -D ohne Einträge für Ordner: nur die Dateien, wie der Store sie erwartet
    execFileSync("zip", ["-q", "-r", "-X", "-D", zip, "."], { cwd: arbeit });
    return zip;
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [tag, ausgabe] = process.argv.slice(2);
  if (!tag || !ausgabe) {
    console.error("Aufruf: bun scripts/elster-helfer/paket.ts <tag> <ausgabeordner>");
    process.exit(2);
  }
  const projekt = fileURLToPath(new URL("../../apps/elster-helfer", import.meta.url));
  console.log(packen(bauen(projekt), tag, ausgabe));
}
