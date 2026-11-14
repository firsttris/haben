import { parseArgs } from "node:util";

/**
 * Befehl `haben` im Image (Wrapper /usr/local/bin/haben, gebaut mit `bun build` im Containerfile):
 *
 *   haben status          Version, ERiC und letzte Sicherung
 *   haben status --json   dasselbe als JSON mit dem Zeichen der Firma, für deploy/instanzen/haben-instanzen.ts
 *   haben kennzeichen     das Logo, das die Firma als Zeichen gewählt hat, als Bytes nach stdout (#1036)
 */
const HILFE = `Aufruf: haben status [--json]
        haben kennzeichen > logo.png`;

function argumente(): { befehl: string | undefined; json: boolean; hilfe: boolean } | null {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
    if (positionals.length > 1) return null;
    if (positionals[0] === "kennzeichen" && values.json) return null;
    return { befehl: positionals[0], json: values.json === true, hilfe: values.help === true || positionals[0] === "hilfe" };
  } catch {
    return null;
  }
}

/** Nur der Fehlercode, auch aus dem Fehler, den Drizzle um den von postgres legt: die Meldungen enthalten Verbindungsangaben */
function datenbankFehler(text: string, error: unknown): void {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  console.error(`${text}; ist die Datenbank erreichbar?${typeof code === "string" ? ` (${code})` : ""}`);
  process.exitCode = 1;
}

const args = argumente();
if (args?.hilfe) {
  console.log(HILFE);
} else if (args?.befehl === "status") {
  // Erst hier: Die Datenbank prüft beim Laden die Umgebung, Hilfe und Aufruffehler gehen auch ohne
  const { closeDatabase } = await import("../../db/index.ts");
  const { betriebsStatus, statusAlsText } = await import("./status.ts");
  try {
    const status = await betriebsStatus();
    console.log(args.json ? JSON.stringify(status) : statusAlsText(status));
  } catch (error) {
    datenbankFehler("Der Stand konnte nicht gelesen werden", error);
  } finally {
    await closeDatabase();
  }
} else if (args?.befehl === "kennzeichen") {
  const { closeDatabase } = await import("../../db/index.ts");
  const { kennzeichenAusgeben } = await import("./kennzeichen.ts");
  try {
    process.exitCode = await kennzeichenAusgeben(process.stdout, (text) => console.error(text));
  } catch (error) {
    datenbankFehler("Das Logo konnte nicht gelesen werden", error);
  } finally {
    await closeDatabase();
  }
} else {
  console.error(HILFE);
  process.exitCode = 2;
}
