import { deflateSync } from "node:zlib";

/*
 * Erfundene Logos für Tests und Bilder des Firmenportals (#1036): deterministisch erzeugte PNGs in verschiedenen Größen
 * und Seitenverhältnissen, damit sich zeigt, wie die Kachel ein Logo skaliert. Keine echten Marken und keine
 * Binärdateien im Repository; jedes Logo entsteht aus wenigen Formen.
 */

type Farbe = readonly [r: number, g: number, b: number, a: number];
/** Farbe eines Pixels, gemessen in Anteilen der Breite und Höhe (0 bis 1) */
type Zeichnen = (x: number, y: number) => Farbe | null;

const LEER: Farbe = [0, 0, 0, 0];

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(daten: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of daten) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function abschnitt(typ: string, inhalt: Uint8Array): Uint8Array {
  const kopf = new Uint8Array(8 + inhalt.length + 4);
  const sicht = new DataView(kopf.buffer);
  sicht.setUint32(0, inhalt.length);
  kopf.set(new TextEncoder().encode(typ), 4);
  kopf.set(inhalt, 8);
  sicht.setUint32(8 + inhalt.length, crc32(kopf.subarray(4, 8 + inhalt.length)));
  return kopf;
}

/** PNG mit RGBA, 8 Bit je Kanal (W3C PNG Specification, 11.2 und 12) */
export function png(breite: number, hoehe: number, zeichnen: Zeichnen): Uint8Array<ArrayBuffer> {
  const zeilen = new Uint8Array(hoehe * (breite * 4 + 1));
  for (let y = 0; y < hoehe; y++) {
    const anfang = y * (breite * 4 + 1);
    for (let x = 0; x < breite; x++) zeilen.set(zeichnen((x + 0.5) / breite, (y + 0.5) / hoehe) ?? LEER, anfang + 1 + x * 4);
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, breite);
  new DataView(ihdr.buffer).setUint32(4, hoehe);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const teile = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    abschnitt("IHDR", ihdr),
    abschnitt("IDAT", new Uint8Array(deflateSync(zeilen))),
    abschnitt("IEND", new Uint8Array()),
  ];
  const datei = new Uint8Array(teile.reduce((summe, t) => summe + t.length, 0));
  let stelle = 0;
  for (const t of teile) {
    datei.set(t, stelle);
    stelle += t.length;
  }
  return datei;
}

const kreis =
  (cx: number, cy: number, r: number, verhaeltnis = 1) =>
  (x: number, y: number) =>
    ((x - cx) * verhaeltnis) ** 2 + (y - cy) ** 2 <= r * r;
const rechteck = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

export interface TestLogo {
  /** Dateiname in PORTAL_LOGOS */
  datei: string;
  breite: number;
  hoehe: number;
  /** Was das Logo prüft */
  wozu: string;
  daten: Uint8Array<ArrayBuffer>;
}

const BLAU: Farbe = [29, 78, 216, 255];
const GRAU: Farbe = [55, 65, 81, 255];
const GRUEN: Farbe = [21, 128, 61, 255];
const ORANGE: Farbe = [234, 88, 12, 255];
const WEISS: Farbe = [255, 255, 255, 255];
const LILA: Farbe = [124, 58, 237, 255];
const NACHT: Farbe = [15, 23, 42, 255];
const GELB: Farbe = [250, 204, 21, 255];

/** Die erfundenen Logos; alle mit durchsichtigem Rand außer „voll“ */
export function testLogos(): TestLogo[] {
  // Schriftzug 4 : 1, wie ihn viele Firmen auf dem Briefpapier führen: Bildzeichen links, Balken als „Schrift“
  const wort = (x: number, y: number): Farbe | null => {
    if (kreis(0.1, 0.5, 0.4, 4)(x, y)) return kreis(0.1, 0.5, 0.2, 4)(x, y) ? WEISS : BLAU;
    if (rechteck(0.25, 0.3, 0.6, 0.45)(x, y) || rechteck(0.25, 0.55, 0.9, 0.7)(x, y)) return GRAU;
    return null;
  };
  // Hochformat 1 : 3: drei Punkte in einer Kapsel
  const hoch = (x: number, y: number): Farbe | null => {
    const kapsel = rechteck(0.1, 0.15, 0.9, 0.85)(x, y) || kreis(0.5, 0.15, 0.4 / 3, 1 / 3)(x, y) || kreis(0.5, 0.85, 0.4 / 3, 1 / 3)(x, y);
    if (!kapsel) return null;
    return [0.25, 0.5, 0.75].some((cy) => kreis(0.5, cy, 0.08, 1 / 3)(x, y)) ? WEISS : GRUEN;
  };
  // Quadrat, groß: Ring
  const ring = (x: number, y: number): Farbe | null => (kreis(0.5, 0.5, 0.45)(x, y) ? (kreis(0.5, 0.5, 0.25)(x, y) ? WEISS : ORANGE) : null);
  // Sehr klein: Raute aus wenigen Pixeln
  const raute = (x: number, y: number): Farbe | null => (Math.abs(x - 0.5) + Math.abs(y - 0.5) <= 0.45 ? LILA : null);
  // Randlos und deckend: dunkle Fläche bis an den Rand, gelbes Dreieck
  const voll = (x: number, y: number): Farbe => (y > 0.25 && y < 0.8 && Math.abs(x - 0.5) < (y - 0.25) * 0.8 ? GELB : NACHT);
  return [
    { datei: "breit.png", breite: 480, hoehe: 120, wozu: "Schriftzug 4 : 1", daten: png(480, 120, wort) },
    { datei: "hoch.png", breite: 120, hoehe: 360, wozu: "Hochformat 1 : 3", daten: png(120, 360, hoch) },
    { datei: "gross.png", breite: 1024, hoehe: 1024, wozu: "Quadrat, groß", daten: png(1024, 1024, ring) },
    { datei: "klein.png", breite: 16, hoehe: 16, wozu: "Quadrat, sehr klein", daten: png(16, 16, raute) },
    { datei: "voll.png", breite: 256, hoehe: 256, wozu: "randlos und deckend", daten: png(256, 256, voll) },
  ];
}
