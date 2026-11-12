import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import type { Logo } from "./types.ts";

// Paketverzeichnis mit templates/ und fonts/; im gebündelten Server per HABEN_EINVOICE_DIR gesetzt.
export const PACKAGE_DIR = process.env.HABEN_EINVOICE_DIR ?? fileURLToPath(new URL("..", import.meta.url));
const IMAGE_PROBE_TEMPLATE = join(PACKAGE_DIR, "templates", "bildprobe.typ");
const FONT_FILES = [
  ...["IBMPlexSans", "IBMPlexSerif", "FiraSans", "Figtree", "Inter", "LibreFranklin", "Literata", "Lora", "NunitoSans"].flatMap((family) =>
    ["Regular", "Medium", "SemiBold", "Italic", "SemiBoldItalic"].map((style) => `${family}-${style}.ttf`),
  ),
  ...["Regular", "Medium", "Semibold", "It", "SemiboldIt"].map((style) => `SourceSans3-${style}.ttf`),
];
const FONTS = FONT_FILES.map((file) => join(PACKAGE_DIR, "fonts", file));

let compiler: NodeCompiler | undefined;

/** Compiler mit den Schriften der Belege; Typst liest nur Dateien unter workspace */
export function createCompiler(workspace: string): NodeCompiler {
  return NodeCompiler.create({ workspace, fontArgs: [{ fontBlobs: FONTS.map((path) => readFileSync(path)) }] });
}

export function getCompiler(): NodeCompiler {
  compiler ??= createCompiler(join(PACKAGE_DIR, "templates"));
  return compiler;
}

/** Ob Typst das Bild in ein PDF/A einbetten kann; CMYK und beschädigte Dateien scheitern erst dabei und verhinderten sonst jedes spätere PDF */
export function embedsInPdf(image: Logo): boolean {
  const typst = getCompiler();
  const file = `bildprobe.${image.format}`;
  const path = join(PACKAGE_DIR, "templates", file);
  typst.mapShadow(path, Buffer.from(image.data));
  try {
    compileWith(typst, IMAGE_PROBE_TEMPLATE, { file }, "2026-01-01", "Die Bildprobe");
    return true;
  } catch {
    return false;
  } finally {
    typst.unmapShadow(path);
  }
}

export function compileWith(typst: NodeCompiler, template: string, data: unknown, date: string, label: string): Uint8Array {
  const result = typst.compile({ mainFilePath: template, inputs: { data: JSON.stringify(data) } });
  const document = result.result;
  if (result.hasError() || !document) {
    const error = result.takeError();
    const diagnostics = error ? typst.fetchDiagnostics(error) : [];
    throw new Error(`${label} konnte nicht erzeugt werden: ${JSON.stringify(diagnostics)}`);
  }
  const pdf = typst.pdf(document, { pdfStandard: "a-3b", creationTimestamp: Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000) });
  typst.evictCache(10);
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
}
