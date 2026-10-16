/** Prüfwert, wie er in Mail, Jahresarchiv und Oberfläche steht: „Nr. 1234 · <SHA-256>“ */
export function formatPruefwert(head: { seq: number; hash: string }): string {
  return `Nr. ${head.seq} · ${head.hash}`;
}

/** Liest einen Prüfwert zurück; tolerant gegenüber Leerzeichen, Zeilenumbrüchen und Großbuchstaben */
export function parsePruefwert(text: string): { seq: number; hash: string } | null {
  const match = /(\d{1,15})\D+?([0-9a-f]{64})(?![0-9a-f])/i.exec(text.replace(/\s+/g, " "));
  if (!match) return null;
  return { seq: Number(match[1]), hash: match[2]!.toLowerCase() };
}
