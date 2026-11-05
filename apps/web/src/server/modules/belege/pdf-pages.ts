import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ExtractionError } from "./extraction-schema.ts";

/*
 * PDF → Seitenbilder für Dienste, die keine PDFs annehmen (Ollama, LM Studio, vLLM mit Vision-Modell).
 * pdftoppm aus poppler-utils läuft als eigener Prozess: kein natives Paket im Serverprozess, ein beschädigtes PDF kann
 * ihn nicht abstürzen lassen. Im Image ist es installiert, sonst meldet die Auslesung, was fehlt.
 */

const run = promisify(execFile);

/** Längere Seite in Pixeln: A4 wird rund 1130 × 1600, genug für Kassenzettel und Kleingedrucktes */
const SCALE_TO = 1600;
const TIMEOUT_MS = 60_000;

export interface PageImages {
  /** PNG je Seite, in Seitenfolge */
  pages: Uint8Array[];
  /** Das PDF hat mehr Seiten als umgewandelt wurden */
  truncated: boolean;
}

export type PdfToImages = (pdf: Uint8Array, maxPages: number) => Promise<PageImages>;

export const pdfToPageImages: PdfToImages = async (pdf, maxPages) => {
  // Eigenes Verzeichnis (0700), danach wieder gelöscht: die Seiten sind Beleginhalt
  const dir = await mkdtemp(join(tmpdir(), "haben-seiten-"));
  try {
    const input = join(dir, "beleg.pdf");
    await writeFile(input, pdf);
    // Eine Seite mehr als nötig, um zu erkennen, dass das PDF länger ist
    await run("pdftoppm", ["-png", "-scale-to", String(SCALE_TO), "-f", "1", "-l", String(maxPages + 1), input, join(dir, "seite")], {
      timeout: TIMEOUT_MS,
    }).catch((error: unknown) => {
      throw conversionError(error);
    });
    const files = (await readdir(dir)).filter((name) => name.startsWith("seite-") && name.endsWith(".png")).sort(byPageNumber);
    if (files.length === 0) throw new ExtractionError("Das PDF enthält keine Seite, die sich als Bild auslesen lässt.", "pdf-leer");
    const pages = await Promise.all(files.slice(0, maxPages).map(async (name) => new Uint8Array(await readFile(join(dir, name)))));
    return { pages, truncated: files.length > maxPages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** seite-2.png vor seite-10.png; pdftoppm füllt die Nummer je nach Seitenzahl mit Nullen auf */
function byPageNumber(a: string, b: string): number {
  return pageNumber(a) - pageNumber(b);
}

function pageNumber(name: string): number {
  return Number(/-(\d+)\.png$/.exec(name)?.[1] ?? 0);
}

/** Die Ausgabe von pdftoppm bleibt draußen; sie kann Text aus dem PDF enthalten */
function conversionError(error: unknown): ExtractionError {
  const { code, killed } = (error ?? {}) as { code?: unknown; killed?: boolean };
  if (code === "ENOENT") {
    return new ExtractionError(
      "PDFs kann Haben für den KI-Dienst nicht in Bilder umwandeln, weil pdftoppm (poppler-utils) fehlt. Bitte poppler-utils installieren oder den Beleg als Foto (JPEG, PNG) hochladen.",
      "pdftoppm-fehlt",
    );
  }
  if (killed) return new ExtractionError("Das PDF ließ sich nicht rechtzeitig in Bilder umwandeln.", "pdf-zeitueberschreitung");
  return new ExtractionError("Das PDF ließ sich nicht in Bilder umwandeln. Ist es beschädigt oder mit einem Passwort geschützt?", "pdf-unlesbar");
}
