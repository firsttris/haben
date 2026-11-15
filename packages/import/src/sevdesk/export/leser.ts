import { parseDatevBuchungsstapel } from "../../datev.ts";
import { buildVouchers } from "./belege.ts";
import { parseDocumentXml } from "./document-xml.ts";
import { baseName, DEFAULT_LIMITS, unzipLimited, type Budget } from "./entpacken.ts";
import type { SevExportDocument, SevExportFile, SevExportOptions, SevExportResult, SevExportStack } from "./types.ts";

/*
 * Liest den Export „Buchungsdaten & Belegbilder“ von sevDesk (Steuern › Mein Steuerberater), ohne Datenbank.
 * Aufbau laut Testdaten (test-fixtures/sevdesk/README.md): `EXTF_Buchungsstapel_….csv`, `EXTF_GP_Stamm_….csv`
 * und je Richtung `DATEV_Rechnungsausgang_….zip` bzw. `DATEV_Rechnungseingang_….zip` mit `document.xml` und den
 * Belegdateien. Stapel liest der vorhandene DATEV-Leser; die Stammdaten bleiben ungelesen.
 *
 * Als sevDesk erkannt wird eine ZIP mit Buchungsstapel und Stammdaten oder Belegordner. Ein Accountable-Export
 * hat auch einen Stapel, aber `Belege.zip` statt der Ordner und keine Stammdaten.
 */

const STACK = /^EXTF_Buchungsstapel.*\.csv$/i;
const PARTNERS = /^EXTF_GP_Stamm.*\.csv$/i;
const FOLDER = /^DATEV_Rechnungs(ausgang|eingang).*\.zip$/i;

const wanted = (path: string) => [STACK, PARTNERS, FOLDER].some((pattern) => pattern.test(baseName(path)));
const named = (files: Record<string, Uint8Array>, pattern: RegExp) =>
  Object.keys(files)
    .filter((path) => pattern.test(baseName(path)))
    .sort();

/** Die Datei aus `<extension name>`: genau unter dem Namen, sonst unter einem Ordner der inneren ZIP */
function fileIn(files: Record<string, Uint8Array>, fileName: string): Uint8Array | undefined {
  return files[fileName] ?? files[Object.keys(files).find((path) => baseName(path) === fileName) ?? ""];
}

type Folders = { ok: true; documents: SevExportDocument[]; files: Map<string, SevExportFile> } | { ok: false; reason: string };

function readFolders(outer: Record<string, Uint8Array>, budget: Budget, hints: string[]): Folders {
  const documents: SevExportDocument[] = [];
  const files = new Map<string, SevExportFile>();
  for (const archive of named(outer, FOLDER)) {
    const inner = unzipLimited(outer[archive]!, budget, () => true);
    if (!inner.ok) {
      if (inner.limit) return { ok: false, reason: inner.reason };
      hints.push(`${archive}: ${inner.reason}`);
      continue;
    }
    const xml = Object.keys(inner.files).find((path) => baseName(path).toLowerCase() === "document.xml");
    if (!xml) {
      hints.push(`${archive}: document.xml fehlt; die Belegdateien lassen sich keiner Buchung zuordnen.`);
      continue;
    }
    const parsed = parseDocumentXml(inner.files[xml]!, archive);
    if (!parsed.ok) return parsed;
    hints.push(...parsed.hints);
    for (const document of parsed.documents) {
      if (documents.some((d) => d.guid === document.guid)) {
        hints.push(`${archive}: GUID ${document.guid} steht schon in einem anderen document.xml; der erste Eintrag gilt.`);
        continue;
      }
      documents.push(document);
      const bytes = fileIn(inner.files, document.fileName);
      if (bytes) files.set(document.guid, { fileName: document.fileName, bytes });
      else hints.push(`${archive}: Datei ${document.fileName} (GUID ${document.guid}) steht in document.xml, fehlt aber in der ZIP.`);
    }
  }
  return { ok: true, documents, files };
}

type Stacks = { ok: true; stacks: SevExportStack[] } | { ok: false; reason: string };

function readStacks(outer: Record<string, Uint8Array>, options: SevExportOptions, hints: string[]): Stacks {
  const stacks: SevExportStack[] = [];
  for (const name of named(outer, STACK)) {
    const bytes = outer[name]!;
    let stack: SevExportStack["stack"];
    try {
      stack = parseDatevBuchungsstapel(bytes);
    } catch (error) {
      return { ok: false, reason: `${name}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const fromHeader = stack.header.kontenrahmen === "SKR03" || stack.header.kontenrahmen === "SKR04" ? stack.header.kontenrahmen : null;
    if (fromHeader && fromHeader !== options.kontenrahmen)
      hints.push(`${name}: Kopf nennt ${fromHeader}, eingestellt ist ${options.kontenrahmen}; es gilt der Kopf.`);
    hints.push(...stack.warnings.map((w) => `${name}: ${w}`));
    stacks.push({ name, bytes, stack, kontenrahmen: fromHeader ?? options.kontenrahmen });
  }
  return { ok: true, stacks };
}

export function readSevdeskExport(archive: Uint8Array, options: SevExportOptions): SevExportResult {
  const budget: Budget = { limits: { ...DEFAULT_LIMITS, ...options.limits }, entries: 0, bytes: 0 };
  const outer = unzipLimited(archive, budget, wanted);
  if (!outer.ok) return { ok: false, reason: outer.reason };
  if (named(outer.files, STACK).length === 0) {
    return { ok: false, reason: "Kein Export „Buchungsdaten & Belegbilder“ von sevDesk: EXTF_Buchungsstapel_….csv fehlt." };
  }
  if (named(outer.files, PARTNERS).length === 0 && named(outer.files, FOLDER).length === 0) {
    return {
      ok: false,
      reason:
        "Die ZIP-Datei sieht nicht nach dem Export „Buchungsdaten & Belegbilder“ von sevDesk aus: Stammdaten (EXTF_GP_Stamm_….csv) und Belegordner (DATEV_Rechnungsausgang_….zip, DATEV_Rechnungseingang_….zip) fehlen.",
    };
  }
  const hints: string[] = [];
  const folders = readFolders(outer.files, budget, hints);
  if (!folders.ok) return folders;
  const stacks = readStacks(outer.files, options, hints);
  if (!stacks.ok) return stacks;
  const vouchers = buildVouchers(stacks.stacks, folders.documents, hints);
  const partnerFiles = named(outer.files, PARTNERS).map((name) => ({ name, bytes: outer.files[name]! }));
  return { ok: true, export: { stacks: stacks.stacks, partnerFiles, vouchers, documents: folders.documents, files: folders.files, hints } };
}
