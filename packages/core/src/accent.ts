/** Akzentfarbe der Belegvorlagen (Überschriften, Linien), solange in den Einstellungen keine andere steht */
export const DEFAULT_ACCENT = "#1F6F5C";

/** Hex-Farbe #RRGGBB, wie sie das Farbfeld des Browsers liefert */
export const ACCENT_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Kontrast einer Farbe #RRGGBB zu weißem Papier nach WCAG 2.2 (relative Leuchtdichte), 1 bis 21 */
export function contrastOnWhite(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

/** WCAG 2.2, 1.4.3: 4,5 : 1 für kleine Schrift; die Spaltenköpfe stehen in 8 pt */
export const MIN_TEXT_CONTRAST = 4.5;
