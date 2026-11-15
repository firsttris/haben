/**
 * Manche Belege liefert FastBill samt der Hülle des Formular-Uploads, mit dem sie einmal hochgeladen wurden: erst eine
 * Trennzeile („------…11112222333344“), Kopfzeilen wie „Content-Disposition: form-data; …“ und „Content-Type: …“, eine
 * Leerzeile, dann die Datei, zum Schluss die schließende Trennzeile mit „--“. Gefunden an echten Ausgabenbelegen
 * (November 2026); tolerante PDF-Leser öffnen sie trotzdem, die Prüfung der Dateiart nicht.
 *
 * Gibt den Inhalt zwischen Kopf und schließender Trennzeile zurück, Byte für Byte unverändert, oder null, wenn die Datei
 * nicht genau diese Form mit genau einem Teil hat. Ob der Inhalt eine erlaubte Dateiart ist, prüft der Aufrufer.
 */
export function unwrapFormUpload(bytes: Uint8Array): Uint8Array | null {
  // Trennzeile: "--" plus Kennung, höchstens 200 Zeichen, bis CRLF
  const lineEnd = indexOf(bytes, CRLF, 0, 202);
  if (lineEnd < 3 || bytes[0] !== DASH || bytes[1] !== DASH) return null;
  const boundary = bytes.subarray(0, lineEnd);
  if (!boundary.every((b) => b > 0x20 && b < 0x7f)) return null;

  // Kopfzeilen bis zur Leerzeile; sie müssen nach einem Formularteil aussehen
  const headerEnd = indexOf(bytes, CRLFCRLF, lineEnd, 4096);
  if (headerEnd < 0) return null;
  const headers = new TextDecoder("latin1").decode(bytes.subarray(lineEnd + 2, headerEnd)).toLowerCase();
  if (!headers.includes("content-disposition: form-data")) return null;

  // Schluss: CRLF, dieselbe Trennzeile, "--", danach höchstens noch CRLF
  const closing = new Uint8Array([...CRLF, ...boundary, DASH, DASH]);
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
  const closingStart = end - closing.length;
  if (closingStart <= headerEnd || !closing.every((b, i) => bytes[closingStart + i] === b)) return null;

  const content = bytes.subarray(headerEnd + 4, closingStart);
  // Genau ein Teil: keine weitere Trennzeile im Inhalt
  if (indexOf(content, new Uint8Array([...CRLF, ...boundary]), 0, content.length) >= 0) return null;
  return content.length > 0 ? content.slice() : null;
}

const DASH = 0x2d;
const CRLF = new Uint8Array([0x0d, 0x0a]);
const CRLFCRLF = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);

/** Erste Fundstelle von needle in haystack ab from, nur innerhalb der ersten limit Bytes; sonst -1 */
function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number, limit: number): number {
  const last = Math.min(haystack.length - needle.length, limit);
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
