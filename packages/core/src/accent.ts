/** Akzentfarbe der Belegvorlagen (Überschriften, Linien), solange in den Einstellungen keine andere steht */
export const DEFAULT_ACCENT = "#1F6F5C";

/** Hex-Farbe #RRGGBB, wie sie das Farbfeld des Browsers liefert */
export const ACCENT_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Relative Leuchtdichte einer Farbe #RRGGBB nach WCAG 2.2, 0 (Schwarz) bis 1 (Weiß) */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Kontrast einer Farbe #RRGGBB zu weißem Papier nach WCAG 2.2 (relative Leuchtdichte), 1 bis 21 */
export function contrastOnWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/**
 * Dunkle Schrift auf hellen Farben. Schwarz, nicht der Text der Vorlagen (#16211C): Nur mit Schwarz hält die bessere
 * der beiden Schriften für jede Farbe 4,5 : 1 (mindestens 4,58 : 1 um #777777); mit #16211C wären es dort nur 4,08 : 1.
 */
const INK_ON_LIGHT = "#000000";

/**
 * Schrift auf einer farbigen Fläche, etwa dem „H“ in der eigenen Farbe der Navigation (#504): Weiß oder Dunkel, je
 * nachdem, was nach WCAG 2.2 den höheren Kontrast hat
 */
export function inkOnAccent(hex: string): "#FFFFFF" | "#000000" {
  const accent = luminance(hex);
  const onWhite = 1.05 / (accent + 0.05);
  const onDark = (accent + 0.05) / (luminance(INK_ON_LIGHT) + 0.05);
  return onWhite >= onDark ? "#FFFFFF" : INK_ON_LIGHT;
}

/** WCAG 2.2, 1.4.3: 4,5 : 1 für kleine Schrift; die Spaltenköpfe stehen in 8 pt */
export const MIN_TEXT_CONTRAST = 4.5;

/** Farbe in OKLCH: Helligkeit 0–1, Buntheit (Chroma), Farbton in Grad */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

// Umrechnung sRGB ↔ OKLab nach Björn Ottosson, „A perceptual color space for image processing“ (2020), wie in CSS Color 4
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function oklch(hex: string): Oklch {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** OKLCH → #RRGGBB; was außerhalb von sRGB liegt, wird je Kanal begrenzt */
export function oklchToHex({ l: L, c, h }: Oklch): string {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255))
    .map((v) => v.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
}

/** Text, Beschriftungen und Linien der Belegvorlagen */
export interface AccentPalette {
  ink: string;
  muted: string;
  rule: string;
}

/** Die Grautöne der Vorlagen zur Standardfarbe; sie haben deren leichten Grünstich */
const DEFAULT_PALETTE: AccentPalette = { ink: "#16211C", muted: "#5B6B63", rule: "#D5DDD8" };

/**
 * Grautöne passend zur Akzentfarbe: Helligkeit wie ab Werk, Farbton um so viel gedreht wie die Akzentfarbe gegenüber
 * dem Standardgrün, Buntheit im Verhältnis zu ihr (eine graue Akzentfarbe ergibt neutrales Grau). Ab Werk kommen so die
 * bisherigen Werte heraus, und Text und Linien bleiben nicht grün, wenn die Akzentfarbe blau ist (#222).
 */
export function accentPalette(accent: string): AccentPalette {
  const base = oklch(DEFAULT_ACCENT);
  const target = oklch(accent);
  const turn = target.h - base.h;
  const saturation = Math.min(1, target.c / base.c);
  const derive = (grey: string) => {
    const { l, c, h } = oklch(grey);
    return oklchToHex({ l, c: c * saturation, h: (h + turn + 360) % 360 });
  };
  return { ink: derive(DEFAULT_PALETTE.ink), muted: derive(DEFAULT_PALETTE.muted), rule: derive(DEFAULT_PALETTE.rule) };
}
