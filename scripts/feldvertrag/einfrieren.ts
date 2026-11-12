/**
 * Schreibt den eingefrorenen Stand des Feldvertrags (packages/einvoice/src/layout-schema.v<n>.json). Nur einmal je Version
 * aufrufen, wenn LAYOUT_SCHEMA_VERSION steigt; eine bestehende Datei wird nie überschrieben, sonst prüfte der Test nichts.
 */
import { existsSync, writeFileSync } from "node:fs";
import { LAYOUT_SCHEMA_VERSION, layoutJsonSchema } from "../../packages/einvoice/src/layout-schema.ts";
import { flattenSchema } from "../../packages/einvoice/src/layout-schema-paths.ts";

const ziel = new URL(`../../packages/einvoice/src/layout-schema.v${LAYOUT_SCHEMA_VERSION}.json`, import.meta.url);
if (existsSync(ziel)) {
  console.error(`Der Stand v${LAYOUT_SCHEMA_VERSION} ist schon eingefroren und bleibt, wie er ist.`);
  process.exit(1);
}
const schema = layoutJsonSchema();
const felder = (s: unknown) => flattenSchema(s as never).map(({ path, type, required }) => ({ path, type, required }));
const zeilen = (liste: { path: string; type: string; required: boolean }[]) => liste.map((feld) => `    ${JSON.stringify(feld)}`).join(",\n");
writeFileSync(
  ziel,
  `{\n  "version": ${schema.version},\n  "beleg": [\n${zeilen(felder(schema.beleg))}\n  ],\n  "mahnung": [\n${zeilen(felder(schema.mahnung))}\n  ]\n}\n`,
);
console.log(`Eingefroren: ${ziel.pathname}`);
