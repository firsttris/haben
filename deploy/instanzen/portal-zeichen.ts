/**
 * Farbe und Logo einer Instanz für das Firmenportal (#1036): aus `haben status --json` (Feld `zeichen`) und
 * `haben kennzeichen` (das Logo als Bytes). Was fehlt oder nicht passt, heißt „kein Zeichen“, nie ein Abbruch: Ein
 * älteres Image kennt das Feld oder den Befehl nicht, die Firma zeigt dann ihren Anfangsbuchstaben.
 */
import { createHash } from "node:crypto";

export interface Zeichen {
  /** #RRGGBB in Großbuchstaben oder null */
  farbe: string | null;
  /** Logo als Zeichen gewählt: Format und SHA-256 (hex), wie die Instanz es meldet */
  logo: { format: "png" | "jpg"; sha256: string } | null;
}

export const KEIN_ZEICHEN: Zeichen = { farbe: null, logo: null };

/** Wie MAX_LOGO_BYTES in Haben und im Firmenportal */
const MAX_BYTES = 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** Das Zeichen aus der Ausgabe von `haben status --json`; ohne Feld oder bei kaputtem JSON keins */
export function zeichenAus(stdout: string): Zeichen {
  let roh: unknown;
  try {
    roh = (JSON.parse(stdout) as { zeichen?: unknown }).zeichen;
  } catch {
    return KEIN_ZEICHEN;
  }
  if (typeof roh !== "object" || roh === null) return KEIN_ZEICHEN;
  const { farbe, logo } = roh as { farbe?: unknown; logo?: unknown };
  const { format, sha256 } = (typeof logo === "object" && logo !== null ? logo : {}) as { format?: unknown; sha256?: unknown };
  return {
    farbe: typeof farbe === "string" && /^#[0-9A-Fa-f]{6}$/.test(farbe) ? farbe.toUpperCase() : null,
    logo: (format === "png" || format === "jpg") && typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256) ? { format, sha256 } : null,
  };
}

export const sha256 = (daten: Uint8Array) => createHash("sha256").update(daten).digest("hex");

/** Prüft die Bytes aus `haben kennzeichen` gegen das, was der Status angekündigt hat; sonst der Grund */
export function logoPruefen(daten: Uint8Array, erwartet: NonNullable<Zeichen["logo"]>): string | null {
  if (daten.length === 0) return "ist leer";
  if (daten.length > MAX_BYTES) return "ist größer als 1 MB";
  const kopf = erwartet.format === "png" ? PNG : JPEG;
  if (!kopf.every((byte, i) => daten[i] === byte)) return `ist kein ${erwartet.format === "png" ? "PNG" : "JPEG"}`;
  if (sha256(daten) !== erwartet.sha256) return "hat eine andere Prüfsumme als gemeldet";
  return null;
}
