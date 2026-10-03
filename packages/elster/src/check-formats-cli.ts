/**
 * Prüft die Nachrichten von Belegabruf, Berechtigungsmanagement und Postfach mit dem installierten ERiC,
 * ohne etwas zu senden:
 *   node --experimental-strip-types packages/elster/src/check-formats-cli.ts
 * ERiC kommt aus ERIC_HOME oder aus ERIC_DIR (Standard data/eric). Exit-Code 1, wenn ERiC etwas bemängelt.
 */
import { resolve } from "node:path";
import { checkFormats } from "./formatprobe.ts";
import { ericHomeIn } from "./install.ts";
import { EricProcessClient } from "./process-client.ts";
import { TEST_HERSTELLER_ID } from "./xml.ts";

const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));
if (!ericHome) {
  console.error("Kein ERiC gefunden. ERIC_HOME setzen oder ERiC mit install-cli.ts nach ERIC_DIR laden.");
  process.exit(2);
}

const results = await checkFormats(new EricProcessClient({ ericHome }), {
  idnr: "65929970489",
  geburtsdatum: "1985-04-12",
  datenlieferant: "Haben Formatprüfung",
  herstellerId: process.env.ELSTER_HERSTELLER_ID || TEST_HERSTELLER_ID,
  veranlagungsjahr: new Date().getFullYear() - 1,
  produktVersion: "0.1.0",
});
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name} (${r.datenartVersion})${r.ok ? "" : `: ${r.code} ${r.message}`}`);
  for (const m of r.meldungen) console.log(`    ${m}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
