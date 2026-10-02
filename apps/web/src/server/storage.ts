import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "./env.ts";

/** Belegdateien liegen unveränderlich unter ihrem SHA-256: <dir>/ab/abcdef… */
function pathFor(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Ungültiger Hash");
  return join(resolve(env().DOCUMENTS_DIR), sha256.slice(0, 2), sha256);
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Schreibt die Datei, falls sie noch nicht liegt; atomar über eine temporäre Datei. */
export async function storeFile(bytes: Uint8Array): Promise<string> {
  const sha256 = sha256Of(bytes);
  const target = pathFor(sha256);
  const exists = await stat(target).then(() => true, () => false);
  if (!exists) {
    await mkdir(join(target, ".."), { recursive: true });
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o640 });
    await rename(tmp, target);
  }
  return sha256;
}

export async function loadFile(sha256: string): Promise<Buffer> {
  const bytes = await readFile(pathFor(sha256));
  if (sha256Of(bytes) !== sha256) throw new Error(`Belegdatei ${sha256} ist beschädigt`);
  return bytes;
}

export async function removeFile(sha256: string): Promise<void> {
  await rm(pathFor(sha256), { force: true });
}

export type DocumentKind = "pdf" | "jpeg" | "png" | "webp" | "heic" | "xml";

const MIME: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  xml: "application/xml",
};

/** Dateityp am Inhalt erkennen, nicht an Endung oder Browser-Angabe. */
export function sniff(bytes: Uint8Array): { kind: DocumentKind; mimeType: string } | null {
  const head = Buffer.from(bytes.subarray(0, 64));
  const ascii = head.toString("latin1");
  let kind: DocumentKind | null = null;
  if (ascii.startsWith("%PDF-")) kind = "pdf";
  else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) kind = "jpeg";
  else if (ascii.startsWith("\x89PNG\r\n\x1a\n")) kind = "png";
  else if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") kind = "webp";
  else if (/^....ftyp(heic|heix|mif1|msf1)/s.test(ascii)) kind = "heic";
  // XML, auch mit UTF-8-BOM (EF BB BF) davor
  else if (/^\s*<(\?xml|[A-Za-z])/.test(ascii.replace(/^\xEF\xBB\xBF/, ""))) kind = "xml";
  return kind ? { kind, mimeType: MIME[kind] } : null;
}
