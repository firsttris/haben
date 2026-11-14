import { parseArgs } from "node:util";

/**
 * Befehl `haben` im Image (Wrapper /usr/local/bin/haben, gebaut mit `bun build` im Containerfile):
 *
 *   haben status          Version, ERiC und letzte Sicherung
 *   haben status --json   dasselbe als JSON, für deploy/instanzen/haben-instanzen.ts
 */
const HILFE = "Aufruf: haben status [--json]";

function argumente(): { befehl: string | undefined; json: boolean; hilfe: boolean } | null {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
    if (positionals.length > 1) return null;
    return { befehl: positionals[0], json: values.json === true, hilfe: values.help === true || positionals[0] === "hilfe" };
  } catch {
    return null;
  }
}

const args = argumente();
if (args?.hilfe) {
  console.log(HILFE);
} else if (args?.befehl !== "status") {
  console.error(HILFE);
  process.exitCode = 2;
} else {
  // Erst hier: Die Datenbank prüft beim Laden die Umgebung, Hilfe und Aufruffehler gehen auch ohne
  const { closeDatabase } = await import("../../db/index.ts");
  const { betriebsStatus, statusAlsText } = await import("./status.ts");
  try {
    const status = await betriebsStatus();
    console.log(args.json ? JSON.stringify(status) : statusAlsText(status));
  } catch (error) {
    // Nur der Fehlercode, auch aus dem Fehler, den Drizzle um den von postgres legt: die Meldungen enthalten
    // Verbindungsangaben und Parameter der Abfrage
    const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
    const code = e?.code ?? e?.cause?.code;
    console.error(`Der Stand konnte nicht gelesen werden; ist die Datenbank erreichbar?${typeof code === "string" ? ` (${code})` : ""}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
