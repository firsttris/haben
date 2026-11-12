// Erzeugt Beispielrechnungen in allen Formaten und prüft sie mit dem KoSIT-Validator.
// Aufruf: KOSIT_JAR=… KOSIT_CONFIG=… bun scripts/kosit-check.ts [ausgabeverzeichnis]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildEInvoice } from "../src/xml.ts";
import { BEISPIELRECHNUNGEN } from "../src/beispielrechnungen.ts";

/** Das Standalone-JAR des Validators in dir, gleich welcher Version (validationtool-… bis 1.5, validator-… ab 1.6) */
function standaloneJar(dir: string): string {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    // Kein Verzeichnis: der Pfad unten nennt im Fehler, wo das JAR erwartet wird
  }
  return join(dir, files.find((f) => f.endsWith("-standalone.jar") && !f.includes("java8")) ?? "validator-standalone.jar");
}

const jar = process.env.KOSIT_JAR ?? standaloneJar("/var/tmp/kosit/validator");
const config = process.env.KOSIT_CONFIG ?? "/var/tmp/kosit/xr/scenarios.xml";
const outDir = process.argv[2] ?? join(tmpdir(), "haben-kosit");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "reports"), { recursive: true });

const files: string[] = [];
for (const [name, doc] of Object.entries(BEISPIELRECHNUNGEN)) {
  const { xml, pdf } = await buildEInvoice(doc);
  const xmlFile = join(outDir, `${name}.xml`);
  writeFileSync(xmlFile, xml);
  writeFileSync(join(outDir, `${name}.pdf`), pdf);
  files.push(xmlFile);
}
console.log(`${files.length} Beispielrechnungen in ${outDir}`);

try {
  execFileSync("java", ["-jar", jar, "-s", config, "-r", dirname(config), "-h", "-o", join(outDir, "reports"), ...files], {
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  // Der Validator meldet Zurückweisungen auch über den Exit-Code; maßgeblich sind die Berichte.
}

let rejected = 0;
for (const file of files) {
  const name = basename(file, ".xml");
  const reportFile = readdirSync(join(outDir, "reports")).find((f) => f === `${name}-report.xml`);
  if (!reportFile) {
    console.log(`FEHLT     ${name}: kein Prüfbericht`);
    rejected++;
    continue;
  }
  const report = readFileSync(join(outDir, "reports", reportFile), "utf8");
  const scenario = /<s:name>([^<]+)<\/s:name>/.exec(report)?.[1] ?? "kein Szenario";
  const accepted = /<rep:accept\b/.test(report);
  const messages = [...report.matchAll(/<rep:message\b[^>]*level="(error|warning)"[^>]*code="([^"]*)"[^>]*>([^<]*)</g)];
  const errors = messages.filter((m) => m[1] === "error");
  const warnings = messages.filter((m) => m[1] === "warning");
  console.log(`${accepted ? "ANGENOMMEN" : "ABGELEHNT "} ${name} [${scenario}] ${errors.length} Fehler, ${warnings.length} Warnungen`);
  for (const [, level, code, text] of messages) console.log(`    ${level} ${code}: ${(text ?? "").trim()}`);
  if (!accepted) rejected++;
}

if (rejected > 0) {
  console.error(`${rejected} von ${files.length} Rechnungen abgelehnt`);
  process.exit(1);
}
console.log("Alle Rechnungen angenommen");
