// Startet den Stub-Worker worker-core-limit.mjs über EricProcessClient und gibt dessen Core-Grenze aus.
// Der Test ruft das mit erlaubten Core-Dumps auf (ulimit -c unlimited), wie auf einem Ubuntu-Runner.
import { fileURLToPath } from "node:url";
import { EricProcessClient } from "../src/process-client.ts";
import { buildUstvaXml, TEST_HERSTELLER_ID } from "../src/xml.ts";

const xml = buildUstvaXml({
  period: { year: 2026, month: 2 },
  steuernummer13: "9198011310010",
  figures: { kz81: 0, kz86: 0, kz66: 0, kz83: 0 },
  datenlieferant: { name: "A", strasse: "B", plz: "1", ort: "C" },
  herstellerId: TEST_HERSTELLER_ID,
  produktVersion: "0.1.0",
  test: true,
});
const workerPath = fileURLToPath(new URL("./worker-core-limit.mjs", import.meta.url));
const result = await new EricProcessClient({ ericHome: "/opt/eric", workerPath }).validate(xml);
process.stdout.write(result.ok ? result.responseXml : `Fehler: ${result.message}`);
