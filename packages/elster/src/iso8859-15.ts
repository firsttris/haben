/*
 * ISO-8859-15 (Latin-9), den Mein ELSTER für hochgeladene Voranmeldungen verlangt. Gleich ISO-8859-1 bis auf acht
 * Stellen, an denen u. a. das Euro-Zeichen steht. Zeichen außerhalb des Zeichensatzes werden zu XML-Zeichenreferenzen
 * („&#8222;“); der Text darf deshalb nur in XML-Inhalt oder Attributwerten stehen.
 */

/** Zeichen, die in ISO-8859-15 an anderer Stelle stehen als in Unicode */
const LATIN9: Record<number, number> = {
  0x20ac: 0xa4, // €
  0x0160: 0xa6, // Š
  0x0161: 0xa8, // š
  0x017d: 0xb4, // Ž
  0x017e: 0xb8, // ž
  0x0152: 0xbc, // Œ
  0x0153: 0xbd, // œ
  0x0178: 0xbe, // Ÿ
};

/** Die Stellen, die ISO-8859-15 anders belegt als ISO-8859-1; ihre Unicode-Zeichen gibt es in Latin-9 nicht */
const REPLACED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);

function byteFor(codePoint: number): number | null {
  if (codePoint in LATIN9) return LATIN9[codePoint]!;
  if (codePoint < 0x100 && !REPLACED.has(codePoint)) return codePoint;
  return null;
}

export function encodeIso885915(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    const byte = byteFor(codePoint);
    if (byte !== null) bytes.push(byte);
    else for (const c of `&#${codePoint};`) bytes.push(c.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
}
