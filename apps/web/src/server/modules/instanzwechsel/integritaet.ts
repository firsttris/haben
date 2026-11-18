import { sha256Of } from "../../storage.ts";

/*
 * Prüfsummen der Einstellungsdatei (#488). Jede eingebettete Datei trägt den SHA-256 ihrer Bytes, die ganze Datei den
 * SHA-256 ihres Inhalts ohne dieses Feld. So fällt beim Import auf, wenn die Datei abgeschnitten, beschädigt oder von
 * Hand geändert wurde. Gegen Absicht schützt das nicht, wer ändert, kann neu rechnen; der Import prüft deshalb jeden
 * Wert wie die Formulare und schreibt nur, was der Inhaber auch selbst eintragen dürfte.
 */

/** SHA-256 des kompakten JSON in der Reihenfolge der Datei; Einrückung und Zeilenenden der Datei zählen nicht */
function contentSha256(content: object): string {
  return sha256Of(new TextEncoder().encode(JSON.stringify(content)));
}

export function withChecksum<T extends object>(content: T): T & { sha256: string } {
  return { ...content, sha256: contentSha256(content) };
}

/** Grund, warum die gelesene Datei nicht unverändert ist, sonst null */
export function checksumProblem(file: unknown): string | null {
  if (typeof file !== "object" || file === null || Array.isArray(file)) return "Das ist keine Einstellungsdatei von Haben.";
  const { sha256, ...content } = file as Record<string, unknown>;
  if (typeof sha256 !== "string") return "Der Datei fehlt die Prüfsumme.";
  if (contentSha256(content) !== sha256) return "Die Prüfsumme stimmt nicht: Die Datei ist beschädigt oder wurde verändert.";
  return null;
}

export type EmbeddedFile = { sha256: string; data: string };

export function embed(bytes: Uint8Array): EmbeddedFile {
  return { sha256: sha256Of(bytes), data: Buffer.from(bytes).toString("base64") };
}

/** Bytes einer eingebetteten Datei, null wenn sie nicht zu ihrem SHA-256 passen */
export function unembed(file: EmbeddedFile): Uint8Array | null {
  const bytes = new Uint8Array(Buffer.from(file.data, "base64"));
  return sha256Of(bytes) === file.sha256 ? bytes : null;
}
