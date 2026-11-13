import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BEISPIELRECHNUNGEN } from "./beispielrechnungen.ts";
import { buildEInvoice } from "./xml.ts";

/*
 * Das XML jeder Beispielrechnung liegt festgehalten in test-fixtures/e-rechnung/. Erzeugt wurde es mit
 * @e-invoice-eu/core 3.4.3 und cii.ts, bevor Haben das XML selbst schreibt (#734). Ändert sich das XML gewollt,
 * etwa nach EN 16931 oder einer neuen XRechnung, schreibt `E_RECHNUNG_VERGLEICH_SCHREIBEN=1 bun run test` die Dateien
 * neu; der Diff gehört mit Begründung in den Pull Request.
 */
const DIR = fileURLToPath(new URL("../test-fixtures/e-rechnung", import.meta.url));
const schreiben = process.env.E_RECHNUNG_VERGLEICH_SCHREIBEN === "1";

describe("E-Rechnung wie festgehalten", () => {
  if (schreiben) mkdirSync(DIR, { recursive: true });

  it.each(Object.entries(BEISPIELRECHNUNGEN))("%s", async (name, doc) => {
    const { xml } = await buildEInvoice(doc);
    const file = join(DIR, `${name}.xml`);
    if (schreiben) writeFileSync(file, xml);
    expect(xml).toBe(readFileSync(file, "utf8"));
  });
});
