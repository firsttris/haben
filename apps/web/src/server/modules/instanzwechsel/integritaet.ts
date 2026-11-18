import { sha256Of } from "../../storage.ts";

/*
 * Prüfsummen der Einstellungsdatei (#488). Die JSON im ZIP nennt jede Datei daneben mit dem SHA-256 ihrer Bytes und trägt
 * selbst den SHA-256 ihres Inhalts ohne dieses Feld; damit deckt ihre Prüfsumme auch die Dateien ab. So fällt beim
 * Import auf, wenn das ZIP abgeschnitten, beschädigt oder von Hand geändert wurde. Gegen Absicht schützt das nicht, wer
 * ändert, kann neu rechnen; der Import prüft deshalb jeden Wert wie die Formulare und schreibt nur, was der Inhaber
 * auch selbst eintragen dürfte.
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

/** Verweis der JSON auf eine Datei im ZIP: Pfad und SHA-256 ihrer Bytes */
export type FileRef = { file: string; sha256: string };

export function fileRef(file: string, bytes: Uint8Array): FileRef {
  return { file, sha256: sha256Of(bytes) };
}

/** Bytes einer Datei aus dem ZIP, null wenn sie fehlt oder nicht zu ihrem SHA-256 passt */
export function referenced(files: Readonly<Record<string, Uint8Array>>, ref: FileRef): Uint8Array | null {
  const bytes = Object.hasOwn(files, ref.file) ? files[ref.file] : undefined;
  return bytes && sha256Of(bytes) === ref.sha256 ? bytes : null;
}
