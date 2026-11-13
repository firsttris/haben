/**
 * Standardeingabe für --oidc-client-secret-stdin: Mit einer Pipe liest das Werkzeug bis zum Ende. Am Terminal fragt
 * es nach und zeigt die Eingabe nicht an, wie docker login oder psql.
 */
import { readFileSync, readSync } from "node:fs";
import { abbrechen } from "./kontext.ts";

const STRG_C = 0x03;
const STRG_D = 0x04;
const RUECK = [0x08, 0x7f];
const ENTER = [0x0a, 0x0d];

/**
 * Setzt eine Zeile aus einzelnen Bytes zusammen, bis Enter, Strg+D oder das Ende kommt. Rücktaste löscht ein ganzes
 * Zeichen, auch wenn es in UTF-8 mehrere Bytes hat; Strg+C bricht ab.
 */
export function zeileAusBytes(naechstes: () => number | null): string {
  const bytes: number[] = [];
  for (;;) {
    const b = naechstes();
    if (b === null || b === STRG_D || ENTER.includes(b)) break;
    if (b === STRG_C) abbrechen("Abgebrochen.");
    if (!RUECK.includes(b)) {
      bytes.push(b);
      continue;
    }
    // Folgebytes (10xxxxxx) gehören zum Zeichen davor
    while (bytes.length > 0 && ((bytes.at(-1) ?? 0) & 0xc0) === 0x80) bytes.pop();
    bytes.pop();
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Liest am Terminal eine Zeile, ohne sie anzuzeigen; die Frage geht auf die Fehlerausgabe, damit sie in keiner Pipe landet */
function verdeckt(frage: string): string {
  const puffer = Buffer.alloc(1);
  process.stderr.write(frage);
  process.stdin.setRawMode(true);
  try {
    return zeileAusBytes(() => (readSync(0, puffer, 0, 1, null) === 0 ? null : (puffer[0] ?? null)));
  } finally {
    process.stdin.setRawMode(false);
    process.stderr.write("\n");
  }
}

export function standardeingabe(): string {
  return process.stdin.isTTY ? verdeckt("Clientsecret: ") : readFileSync(0, "utf8");
}
