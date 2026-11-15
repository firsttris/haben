import { lockFileUse } from "./db/file-in-use.ts";
import type { Tx } from "./db/index.ts";
import { MAX_DOCUMENT_SIZE } from "./grenzen.ts";
import { sha256Of, sniff, storeFile } from "./storage.ts";

/*
 * PDF als Anhang prüfen und ablegen, für Rechnungen und Angebote (rechnungen/attachment-store.ts) und für die
 * unterschriebenen SEPA-Mandate (stammdaten/sepa-mandate.ts). Liegt in der Infrastruktur, weil stammdaten unter
 * rechnungen steht.
 */

export type AttachmentFile = { bytes: Uint8Array; filename: string };

/** Was gegen die Datei als Anhang spricht, oder null; Typ am Inhalt erkannt, Grenze wie bei Belegen */
export function attachmentFileProblem(file: AttachmentFile): string | null {
  if (file.bytes.byteLength === 0) return `${file.filename}: Die Datei ist leer.`;
  if (file.bytes.byteLength > MAX_DOCUMENT_SIZE) return `${file.filename}: größer als 20 MB.`;
  if (sniff(file.bytes)?.kind !== "pdf") return `${file.filename}: Als Anhang sind nur PDF-Dateien erlaubt.`;
  return null;
}

/** Dateiname ohne Pfad und Steuerzeichen, wie er in der E-Mail und im Archiv erscheint */
export function attachmentFilename(raw: string): string {
  const name = (raw.split(/[\\/]/).pop() ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gehören nicht in einen Dateinamen
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  if (!name) return "Anhang.pdf";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** Legt die geprüfte Datei unter der Sperre auf ihren Hash ab (siehe add in rechnungen/attachment-store.ts); liefert, was eine neue Zeile braucht */
export async function storeAttachmentFile(tx: Tx, file: AttachmentFile): Promise<{ filename: string; sha256: string; size: number }> {
  const sha256 = sha256Of(file.bytes);
  await lockFileUse(tx, sha256);
  await storeFile(file.bytes);
  return { filename: attachmentFilename(file.filename), sha256, size: file.bytes.byteLength };
}
