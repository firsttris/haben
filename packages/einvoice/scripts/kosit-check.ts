// Erzeugt Beispielrechnungen in allen Formaten und prüft sie mit dem KoSIT-Validator.
// Aufruf: KOSIT_JAR=… KOSIT_CONFIG=… node --experimental-strip-types scripts/kosit-check.ts [ausgabeverzeichnis]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildEInvoice } from "../src/xml.ts";
import { mixedRateLines, publicBuyer, sampleDocument, sampleSeller } from "../src/samples.ts";
import type { InvoiceDocument } from "../src/types.ts";

const jar = process.env.KOSIT_JAR ?? "/var/tmp/kosit/validator/validationtool-1.5.0-standalone.jar";
const config = process.env.KOSIT_CONFIG ?? "/var/tmp/kosit/xr/scenarios.xml";
const outDir = process.argv[2] ?? join(tmpdir(), "haben-kosit");

const samples: Record<string, InvoiceDocument> = {
  "rechnung-19-zugferd": sampleDocument({ note: "Vielen Dank für die gute Zusammenarbeit." }),
  "rechnung-19-xr-cii": sampleDocument({ format: "xrechnung-cii" }),
  "rechnung-19-xr-ubl": sampleDocument({ format: "xrechnung-ubl" }),
  "gemischt-19-7-zugferd": sampleDocument({ lines: mixedRateLines }),
  "gemischt-19-7-xr-cii": sampleDocument({ format: "xrechnung-cii", lines: mixedRateLines }),
  "gemischt-19-7-xr-ubl": sampleDocument({ format: "xrechnung-ubl", lines: mixedRateLines }),
  "storno-zugferd": sampleDocument({ kind: "storno" }),
  "storno-xr-cii": sampleDocument({ kind: "storno", format: "xrechnung-cii" }),
  "storno-xr-ubl": sampleDocument({ kind: "storno", format: "xrechnung-ubl" }),
  "korrektur-xr-ubl": sampleDocument({ kind: "korrektur", format: "xrechnung-ubl", lines: mixedRateLines }),
  "leitweg-xr-cii": sampleDocument({ format: "xrechnung-cii", buyer: publicBuyer }),
  "leitweg-xr-ubl": sampleDocument({ format: "xrechnung-ubl", buyer: publicBuyer }),
  "leistungsdatum-xr-ubl": { ...sampleDocument({ format: "xrechnung-ubl" }), serviceFrom: "2026-09-30", serviceTo: undefined },
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).map((format) => [
      `nur-steuernummer-${format}`,
      { ...sampleDocument({ format }), seller: { ...sampleSeller, ustId: undefined } },
    ]),
  ),
  "korrektur-gemischt-xr-cii": korrekturMitZuschlag("xrechnung-cii"),
  "korrektur-gemischt-xr-ubl": korrekturMitZuschlag("xrechnung-ubl"),
  "nullsatz-xr-cii": sampleDocument({
    format: "xrechnung-cii",
    lines: [{ description: "Leistung zum Nullsatz", quantity: 1000, unit: "Psch.", unitPrice: 50000, taxRate: 0 }],
  }),
};

/** Korrektur mit gutgeschriebenen und einer nachberechneten Position, insgesamt negativ */
function korrekturMitZuschlag(format: InvoiceDocument["format"]): InvoiceDocument {
  const lines = mixedRateLines.map((line, i) => (i === 2 ? { ...line, unitPrice: -line.unitPrice } : line));
  return sampleDocument({ kind: "korrektur", format, lines });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "reports"), { recursive: true });

const files: string[] = [];
for (const [name, doc] of Object.entries(samples)) {
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
