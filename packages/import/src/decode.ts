/**
 * Dekodiert die Bytes eines Kontoauszugs. UTF-8 (mit oder ohne BOM) und UTF-16 mit BOM;
 * alles, was kein gültiges UTF-8 ist, wird als Windows-1252 gelesen (ältere DKB-Exporte).
 */
export function decodeText(bytes: Uint8Array): string {
  const [b0, b1, b2] = bytes;
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (b0 === 0xff && b1 === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (b0 === 0xfe && b1 === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Windows-1252 ist eine Obermenge von ISO-8859-1 für alle druckbaren Zeichen
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
