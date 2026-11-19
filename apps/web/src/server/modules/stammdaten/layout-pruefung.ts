import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BEISPIEL_PNG, fehlendeAngaben, layoutBeispiele, type Letterhead, type RenderClient, ungenutztePflichtfelder } from "@haben/einvoice";
import { UserError } from "../../errors.ts";
import { customLayoutJob, layoutRenderer } from "./layout-renderer.ts";

const run = promisify(execFile);

/*
 * Prüfung eines eigenen Layouts vor dem Speichern (#113): Haben setzt es mit jedem Beispiel seiner Art im Render-Prozess
 * (Zeitlimit 5 s, kein Netz) und liest das PDF, um die Pflichtangaben zu finden. Erst wenn alles passt, wird gespeichert.
 */

export class LayoutError extends UserError {}

/**
 * Das Layout lädt Pakete, die nicht im Cache des Render-Prozesses liegen (pakete, aus der Adresse des Downloads). Typst
 * entscheidet das selbst beim Setzen, anders als packagesIn, das jede Nennung im Quelltext zählt, auch in Kommentaren (#488)
 */
export class LayoutPaketFehltError extends LayoutError {
  readonly pakete: { name: string; version: string }[];

  constructor(message: string, pakete: { name: string; version: string }[]) {
    super(message);
    this.pakete = pakete;
  }
}

/**
 * So meldet Typst ein Paket, das es ohne Netz nicht laden kann (siehe typstMeldung). Nur am Anfang einer Meldung von Typst:
 * panic und assert stellen ihren eigenen Text dahinter („panicked with: …“), den das Layout frei wählt
 */
const PAKET_FEHLT = /^failed to download package/i;

/** Typst nennt das Paket nur in der Adresse des Downloads: …packages.typst.org/preview/cetz-0.3.4.tar.gz */
const PAKET_ADRESSE = /packages\.typst\.org\/([a-z0-9_-]+)\/([a-z0-9_-]+)-(\d+\.\d+\.\d+)\.tar\.gz/i;

/**
 * Pakete, die Typst nicht laden konnte; leer, wenn keine Meldung so lautet oder eine davon kein Paket nennt. Andere
 * Meldungen daneben zählen nicht: In #context können sie Folgen des fehlenden Pakets sein (query, state)
 */
function fehlendePakete(error: unknown): { name: string; version: string }[] {
  let meldungen: unknown;
  try {
    meldungen = JSON.parse(error instanceof Error ? error.message : String(error));
  } catch {
    return [];
  }
  if (!Array.isArray(meldungen)) return [];
  const adressen = meldungen.flatMap((m: { message?: unknown } | null) =>
    typeof m?.message === "string" && PAKET_FEHLT.test(m.message) ? [PAKET_ADRESSE.exec(m.message)] : [],
  );
  if (adressen.some((adresse) => !adresse)) return [];
  return adressen.map((adresse) => ({ name: `@${adresse![1]}/${adresse![2]}`, version: adresse![3]! }));
}

export const MAX_LAYOUT_BYTES = 256 * 1024;

const PAKET = /@[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*:\d+\.\d+\.\d+/gi;

/** Pakete, die der Quelltext nennt, etwa „@preview/cetz:0.3.4“; zur Laufzeit zusammengesetzte Namen fängt erst das Setzen */
export function packagesIn(source: string): { name: string; version: string }[] {
  const found = [...new Set(source.match(PAKET) ?? [])].sort();
  return found.map((spec) => {
    const [name, version] = spec.split(":") as [string, string];
    return { name, version };
  });
}

/** Typst meldet Fehler als Liste; für die Meldung genügt die erste, mit Zeile */
export function typstMeldung(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("Zeitlimit")) return text;
  const paket = new RegExp(`failed to download package[^"]*?${PAKET_ADRESSE.source}`, "i").exec(text);
  if (paket) return `Das Paket @${paket[1]}/${paket[2]}:${paket[3]} ist nicht freigegeben oder fehlt im Cache.`;
  try {
    const [first] = JSON.parse(text) as { message: string; range?: { start?: { line?: number } } }[];
    if (first) return first.range?.start?.line !== undefined ? `Zeile ${first.range.start.line + 1}: ${first.message}` : first.message;
  } catch {
    // keine Liste von Typst
  }
  return text.slice(0, 300);
}

/** Text je Seite: nach Lage und in der Reihenfolge des Inhalts, denn schräger Text wie der Vermerk zerfällt nach Lage */
async function pdfSeiten(pdf: Uint8Array): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "haben-layout-"));
  try {
    const datei = join(dir, "probe.pdf");
    await writeFile(datei, pdf);
    const lesen = async (...art: string[]) => {
      const { stdout } = await run("pdftotext", [...art, datei, "-"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }).catch((error: { code?: unknown }) => {
        throw new LayoutError(
          error.code === "ENOENT" ? "Layouts lassen sich hier nicht prüfen, weil pdftotext fehlt (poppler-utils)." : "Das gesetzte PDF ließ sich nicht lesen.",
        );
      });
      return stdout.split("\f");
    };
    const [lage, roh] = await Promise.all([lesen(), lesen("-raw")]);
    return lage.map((seite, i) => `${seite}\n${roh[i] ?? ""}`).filter((seite) => seite.trim());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const probeLetterhead: Letterhead = { logo: { data: BEISPIEL_PNG, format: "png" }, background: { data: BEISPIEL_PNG, format: "png" } };

/** Setzt das Layout mit allen Beispielen seiner Art; wirft LayoutError mit allem, was fehlt oder scheitert */
export async function checkLayout(layout: { id: string; source: string; art: "beleg" | "mahnung" }, renderer: RenderClient = layoutRenderer): Promise<void> {
  // Vor dem Setzen: Ein Pflichtfeld, das der Quelltext nicht nennt, kann auf keinem Blatt stehen
  const ungenutzt = ungenutztePflichtfelder(layout.source, layout.art);
  if (ungenutzt.length > 0) {
    throw new LayoutError(`Das Layout verwendet diese Pflichtfelder nicht: ${ungenutzt.map((f) => f.replaceAll("|", " oder ")).join(", ")}.`);
  }
  const probleme: string[] = [];
  for (const beispiel of layoutBeispiele().filter((b) => b.art === layout.art)) {
    let pdf: Uint8Array;
    try {
      pdf = await renderer.renderPdf(await customLayoutJob(layout, beispiel.data, probeLetterhead), "2026-10-02");
    } catch (error) {
      // Ohne das Paket scheitert jedes Beispiel gleich; der Aufrufer muss es unterscheiden können (insertImportedLayout)
      const fehlend = fehlendePakete(error);
      if (fehlend.length > 0) throw new LayoutPaketFehltError(`Das Layout lässt sich so nicht verwenden. ${beispiel.name}: ${typstMeldung(error)}`, fehlend);
      probleme.push(`${beispiel.name}: ${typstMeldung(error)}`);
      // Was schon am Setzen scheitert, scheitert meist an allen Beispielen gleich
      if (probleme.length >= 3) break;
      continue;
    }
    const fehlt = fehlendeAngaben(beispiel, await pdfSeiten(pdf));
    if (fehlt.length > 0) probleme.push(`${beispiel.name}: Es fehlt ${fehlt.slice(0, 5).join(", ")}${fehlt.length > 5 ? " und mehr" : ""}`);
  }
  if (probleme.length > 0) throw new LayoutError(`Das Layout lässt sich so nicht verwenden. ${probleme.join(" · ")}`);
}
