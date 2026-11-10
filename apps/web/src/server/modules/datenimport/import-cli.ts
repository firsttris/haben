import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { closeDatabase } from "../../db/index.ts";
import { userMessage } from "../../errors.ts";
import { externalImportSchema, runExternalImport } from "./index.ts";

/** Lokaler Betreiberimport; dieselbe Transaktion und dieselben Sperren wie die Geschäftslogik. */
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    paket: { type: "string" },
    originale: { type: "string" },
    akteur: { type: "string" },
    anwenden: { type: "boolean" },
  },
});
try {
  if (!values.paket || !values.originale || !values.akteur?.trim())
    throw new Error("Aufruf: bun src/server/modules/datenimport/import-cli.ts --paket bestand.json --originale /pfad --akteur migration:quelle [--anwenden]");
  const input = externalImportSchema.parse(JSON.parse(await readFile(values.paket, "utf8")));
  const directory = resolve(values.originale);
  const file = (hash: string) => readFile(resolve(directory, `${hash}.pdf`));
  if (!values.anwenden) {
    for (const entry of input.entries) {
      if (entry.kind === "journal") continue;
      const bytes = await file(entry.pdfSha256);
      if (createHash("sha256").update(bytes).digest("hex") !== entry.pdfSha256) throw new Error("Originalhash abweichend.");
    }
    console.log(
      JSON.stringify({
        structureAndOriginalHashesChecked: true,
        entries: input.entries.length,
        targetNotChanged: true,
        note: "Zielbestand und Buchungsregeln werden beim Anwenden in einer Transaktion geprüft.",
      }),
    );
  } else console.log(JSON.stringify(await runExternalImport(values.akteur.trim(), input, file)));
} catch (error) {
  // Datenbankfehler können SQL-Parameter mit Originalbelegen enthalten. Keine Rohfehler ausgeben.
  console.error(
    userMessage(error) ?? "Die Übernahme ist fehlgeschlagen. Der Bestand wurde nicht übernommen; Eingabe, Originaldateien und Installation prüfen.",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
