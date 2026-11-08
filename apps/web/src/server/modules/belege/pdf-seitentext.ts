import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/*
 * Text der Seiten eines PDFs für die KI-Auslesung (#329): Hat das PDF eine Textschicht, liest Haben sie lokal mit
 * pdftotext (poppler-utils, wie pdftoppm in pdf-pages.ts) und gibt sie dem Modell mit, auf Wunsch statt der
 * Seitenbilder für ein reines Textmodell. „-layout“ hält Spalten und Tabellen in ihrer Lage; Seiten trennt ein
 * Seitenvorschub. Fehlt das Werkzeug oder ist das PDF kaputt, gibt es keinen Text, nie einen Fehler.
 */

const run = promisify(execFile);
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 20 * 1024 * 1024;

/** So viel Text geht höchstens an das Modell; ein Beleg braucht weit weniger, ein lokales Modell hat wenig Kontext */
export const MAX_TEXT_CHARS = 40_000;

/** Unter so vielen Buchstaben und Ziffern ist eine Seite ohne brauchbaren Text: Stempel, Wasserzeichen, Seitenzahl */
const MIN_CHARS_PER_PAGE = 40;

export type PdfToPageTexts = (pdf: Uint8Array, maxPages: number) => Promise<{ pages: string[]; truncated: boolean } | null>;

/** Text je Seite, höchstens maxPages Seiten; truncated, wenn das PDF mehr hat */
export const pdfPageTexts: PdfToPageTexts = async (pdf, maxPages) => {
  let dir: string | null = null;
  try {
    // Eigenes Verzeichnis (0700), danach gelöscht: der Text ist Beleginhalt
    dir = await mkdtemp(join(tmpdir(), "haben-seitentext-"));
    const input = join(dir, "beleg.pdf");
    await writeFile(input, pdf);
    // Eine Seite mehr lesen als erlaubt: so zeigt sich, ob das PDF länger ist
    const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", "-f", "1", "-l", String(maxPages + 1), input, "-"], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      encoding: "utf8",
    });
    // pdftotext schließt jede Seite mit einem Seitenvorschub ab
    const pages = stdout.split("\f");
    if (pages.at(-1)?.trim() === "") pages.pop();
    return { pages: pages.slice(0, maxPages), truncated: pages.length > maxPages };
  } catch {
    // Ohne pdftotext, bei beschädigten oder geschützten PDFs; die Ausgabe bleibt draußen, sie enthält Beleginhalt
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
};

const usable = (page: string) => (page.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= MIN_CHARS_PER_PAGE;

/**
 * Text für das Modell: die Seiten mit brauchbarem Text, je mit „--- Seite n ---“ davor, damit das Modell die Reihenfolge
 * kennt. missingPages nennt die Seiten ohne, cut eine Kürzung; beides kommt als Hinweis an den Beleg.
 */
export function textForModel(pages: string[]): { text: string | null; missingPages: number[]; cut: boolean } {
  const missingPages = pages.flatMap((page, i) => (usable(page) ? [] : [i + 1]));
  const parts = pages.flatMap((page, i) => (usable(page) ? [`--- Seite ${i + 1} ---\n${page.replace(/[ \t]+$/gm, "").trim()}`] : []));
  if (parts.length === 0) return { text: null, missingPages, cut: false };
  const text = parts.join("\n\n");
  return text.length > MAX_TEXT_CHARS ? { text: `${text.slice(0, MAX_TEXT_CHARS)}\n[… gekürzt]`, missingPages, cut: true } : { text, missingPages, cut: false };
}
