import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TextLine } from "@haben/core";

/*
 * Textebene eines PDFs mit Lage jeder Zeile, für die Erkennung eigener Ausgangsrechnungen. pdftotext aus poppler-utils
 * läuft wie pdftoppm (pdf-pages.ts) als eigener Prozess; „-bbox-layout“ liefert Seiten, Zeilen und Wörter mit
 * Koordinaten als XHTML. Fehlt das Werkzeug oder hat das PDF keinen Text (Scan), gibt es keine Zeilen: Die Erkennung ist
 * eine Zugabe und hält den Upload nie auf.
 */

const run = promisify(execFile);

/** Eigene Rechnungen sind kurz; Fußzeilen stehen auf jeder Seite, die ersten Seiten genügen */
const MAX_PAGES = 5;
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 20 * 1024 * 1024;

export type PdfToText = (pdf: Uint8Array) => Promise<TextLine[] | null>;

export const pdfTextLines: PdfToText = async (pdf) => {
  let dir: string | null = null;
  try {
    // Eigenes Verzeichnis (0700), danach wieder gelöscht: der Text ist Beleginhalt. Im try, denn auch ein volles oder
    // fehlendes Temp-Verzeichnis darf den Upload nicht aufhalten
    dir = await mkdtemp(join(tmpdir(), "haben-text-"));
    const input = join(dir, "beleg.pdf");
    await writeFile(input, pdf);
    const { stdout } = await run("pdftotext", ["-bbox-layout", "-enc", "UTF-8", "-f", "1", "-l", String(MAX_PAGES), input, "-"], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      encoding: "utf8",
    });
    const lines = parseBboxLayout(stdout);
    return lines.length > 0 ? lines : null;
  } catch {
    // Ohne pdftotext, bei beschädigten oder geschützten PDFs: keine Textebene; die Ausgabe bleibt draußen, sie enthält Beleginhalt
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
};

const PAGE = /<page\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g;
const LINE = /<line\b[^>]*\bxMin="([\d.]+)"[^>]*\byMin="([\d.]+)"[^>]*>([\s\S]*?)<\/line>/g;
const WORD = /<word\b[^>]*>([\s\S]*?)<\/word>/g;

/** Zeilen aus der Ausgabe von `pdftotext -bbox-layout`, in Lesereihenfolge; Lage relativ zur Seite */
export function parseBboxLayout(xhtml: string): TextLine[] {
  return [...xhtml.matchAll(PAGE)].flatMap(([, width, height, content], index) => {
    const pageWidth = Number(width);
    const pageHeight = Number(height);
    if (!(pageWidth > 0 && pageHeight > 0)) return [];
    return [...content!.matchAll(LINE)].flatMap(([, xMin, yMin, words]) => {
      const text = [...words!.matchAll(WORD)]
        .map(([, word]) => decodeEntities(word!))
        .join(" ")
        .trim();
      return text ? [{ page: index + 1, text, top: Number(yMin) / pageHeight, left: Number(xMin) / pageWidth }] : [];
    });
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}
