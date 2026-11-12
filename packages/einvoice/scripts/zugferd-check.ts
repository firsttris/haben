// Erzeugt die ZUGFeRD-PDFs aller Beispielrechnungen und prüft sie mit dem Mustang-Validator (PDF/A-3 mit veraPDF,
// dazu das eingebettete factur-x.xml gegen Schema und Schematron von Factur-X).
// Aufruf: MUSTANG_JAR=… bun scripts/zugferd-check.ts [ausgabeverzeichnis]
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BEISPIELRECHNUNGEN } from "../src/beispielrechnungen.ts";
import { buildEInvoice } from "../src/xml.ts";

const run = promisify(execFile);
const jar = process.env.MUSTANG_JAR ?? "/var/tmp/mustang/Mustang-CLI.jar";
const outDir = process.argv[2] ?? join(tmpdir(), "haben-zugferd");
// Je Prüfung startet eine JVM; vier zugleich, so viele Kerne hat der Runner
const PARALLEL = 4;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "reports"), { recursive: true });

const files: string[] = [];
for (const [name, doc] of Object.entries(BEISPIELRECHNUNGEN)) {
  if (doc.format !== "zugferd") continue;
  const { pdf } = await buildEInvoice(doc);
  const file = join(outDir, `${name}.pdf`);
  writeFileSync(file, pdf);
  files.push(file);
}
console.log(`${files.length} ZUGFeRD-PDFs in ${outDir}`);

/** Bericht des Validators; Mustang meldet ein ungültiges PDF auch über den Exit-Code, maßgeblich ist der Bericht */
async function validate(file: string): Promise<string> {
  try {
    return (await run("java", ["-jar", jar, "--action", "validate", "--source", file], { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    return stdout || stderr || String(error);
  }
}

let rejected = 0;
const queue = [...files];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const name = file.slice(outDir.length + 1, -".pdf".length);
      const report = await validate(file);
      writeFileSync(join(outDir, "reports", `${name}.xml`), report);
      const valid = /<summary status="valid"\s*\/>/.test(report);
      console.log(`${valid ? "GÜLTIG  " : "UNGÜLTIG"} ${name}`);
      if (!valid) {
        rejected++;
        for (const [message] of report.matchAll(/<(error|exception)\b[\s\S]*?<\/\1>/g)) console.log(`    ${message.replace(/\s+/g, " ")}`);
      }
    }
  }),
);

if (rejected > 0) {
  console.error(`${rejected} von ${files.length} PDFs ungültig; Berichte in ${join(outDir, "reports")}`);
  process.exit(1);
}
console.log("Alle PDFs gültig");
