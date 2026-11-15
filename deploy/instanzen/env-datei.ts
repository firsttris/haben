/**
 * Die .env einer Instanz lesen wie Docker Compose und einzelne Werte setzen, ohne den Rest der Datei anzufassen.
 *
 * Lesen nach dem Parser von Compose (compose-go, dotenv/parser.go): `export ` davor ist erlaubt, Leerraum um `=`
 * auch; ein Wert in '…' gilt wörtlich, in "…" mit den Escapes \" \\ \n; ohne Anführungszeichen endet der Wert vor
 * einem # mit Leerraum davor, Leerraum am Rand fällt weg. Steht ein Schlüssel mehrmals da, gilt der letzte.
 * Variablen wie ${X} ersetzt das Werkzeug nicht; in den Werten, die es liest (Projekt, Domain), kommen sie nicht vor.
 */
import { chmod, readFile, writeFile } from "node:fs/promises";

const ZEILE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

function wertAus(roh: string): string {
  if (roh.startsWith("'")) {
    const ende = roh.indexOf("'", 1);
    return ende < 0 ? roh.slice(1) : roh.slice(1, ende);
  }
  if (roh.startsWith('"')) {
    let wert = "";
    for (let i = 1; i < roh.length; i++) {
      const c = roh[i];
      if (c === '"') return wert;
      if (c === "\\" && i + 1 < roh.length) {
        const n = roh[++i];
        wert += n === "n" ? "\n" : n;
      } else wert += c;
    }
    return wert;
  }
  return roh.replace(/(^|\s)#.*$/, "").trim();
}

/** Alle Werte der Datei, wie Compose sie liest */
export function envWerte(text: string): Map<string, string> {
  const werte = new Map<string, string>();
  for (const zeile of text.split(/\r?\n/)) {
    const m = ZEILE.exec(zeile);
    if (m?.[1] !== undefined && m[2] !== undefined) werte.set(m[1], wertAus(m[2]));
  }
  return werte;
}

export function envWert(text: string, key: string): string | undefined {
  return envWerte(text).get(key);
}

/** Wert aus einer .env-Datei; fehlt die Datei, undefined */
export async function envDateiWert(datei: string, key: string): Promise<string | undefined> {
  try {
    return envWert(await readFile(datei, "utf8"), key);
  } catch {
    return undefined;
  }
}

/** Werte, die ohne Anführungszeichen sicher sind: Zufallswerte (hex, base64), Namen, Domains, Pfade, Ziffern */
const SICHER = /^[A-Za-z0-9+/=._:@-]*$/;

/**
 * Setzt KEY=Wert: ersetzt die aktive Zeile (die letzte, sie gilt), sonst das erste auskommentierte Beispiel
 * `# KEY=…`, sonst hängt es die Zeile an. Alle anderen Zeilen bleiben Byte für Byte, wie sie sind.
 * `woertlich` setzt den Wert in einfache Anführungszeichen; darin ersetzt Compose kein $ und kein #.
 */
export function envSetzen(text: string, key: string, wert: string, woertlich = false): string {
  if (woertlich ? /['\r\n]/.test(wert) : !SICHER.test(wert)) throw new Error(`Wert für ${key} lässt sich so nicht in die .env schreiben.`);
  const neu = `${key}=${woertlich ? `'${wert}'` : wert}`;
  const zeilen = text.split("\n");
  const aktiv = zeilen.findLastIndex((z) => ZEILE.exec(z)?.[1] === key);
  const beispiel = zeilen.findIndex((z) => new RegExp(`^#\\s*${key}=`).test(z));
  const index = aktiv >= 0 ? aktiv : beispiel;
  if (index >= 0) {
    zeilen[index] = neu;
    return zeilen.join("\n");
  }
  return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${neu}\n`;
}

/** Schreibt eine .env nur für den Besitzer lesbar (600); sie enthält die Schlüssel der Firma */
export async function envSchreiben(datei: string, text: string): Promise<void> {
  await writeFile(datei, text, { mode: 0o600 });
  await chmod(datei, 0o600);
}
