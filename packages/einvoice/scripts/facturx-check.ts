// Prüft die ZUGFeRD-Beispiele aus kosit-check.ts zusätzlich gegen die veröffentlichten Factur-X-Regeln.
// Aufruf: KOSIT_JAR=… bun scripts/facturx-check.ts <beispielverzeichnis> <1.08-xsl> <1.09.2-xsl>
// Saxon liegt bereits im Standalone-JAR von KoSIT; sämtliche failed-asserts, auch Warnungen, lassen den Lauf scheitern.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

const [directory, xsl108, xsl109] = process.argv.slice(2);
const jar = process.env.KOSIT_JAR;
if (!directory || !xsl108 || !xsl109 || !jar) {
  throw new Error("KOSIT_JAR und Argumente <beispielverzeichnis> <1.08-xsl> <1.09.2-xsl> fehlen");
}

const files = readdirSync(directory)
  .filter((file) => file.endsWith("-zugferd.xml"))
  .sort();
if (files.length === 0) throw new Error(`Keine ZUGFeRD-Beispiele in ${directory}`);
const parser = new XMLParser({ removeNSPrefix: true });
let rejected = 0;
for (const [version, stylesheet] of [
  ["1.08", xsl108],
  ["1.09.2", xsl109],
] as const) {
  const reportDir = join(directory, `facturx-${version}`);
  mkdirSync(reportDir, { recursive: true });
  for (const file of files) {
    const report = join(reportDir, `${basename(file, ".xml")}.svrl.xml`);
    execFileSync(
      "java",
      ["-cp", resolve(jar), "net.sf.saxon.Transform", `-s:${resolve(directory, file)}`, `-xsl:${resolve(stylesheet)}`, `-o:${resolve(report)}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const output = parser.parse(readFileSync(report, "utf8"), true)["schematron-output"];
    if (!output) throw new Error(`Kein SVRL-Prüfbericht: ${report}`);
    const failed = output["failed-assert"];
    const findings = failed === undefined ? [] : Array.isArray(failed) ? failed : [failed];
    console.log(`${findings.length === 0 ? "ANGENOMMEN" : "ABGELEHNT "} Factur-X ${version}: ${file}`);
    for (const finding of findings) console.log(`    ${String(finding.text).trim()}`);
    if (findings.length > 0) rejected++;
  }
}

if (rejected > 0) throw new Error(`${rejected} Factur-X-Prüfungen mit Fehlern oder Warnungen`);
console.log(`Alle ${files.length * 2} Factur-X-Prüfungen ohne Fehler und Warnungen`);
