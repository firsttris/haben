import { unzipSync } from "fflate";
import { decodeText } from "../decode.ts";
import { parseCsv } from "../csv.ts";
import type { BuchhaltungsbutlerFile, BuchhaltungsbutlerRow } from "./types.ts";
import { BuchhaltungsbutlerError } from "./types.ts";

export interface ExportPart {
  name: string;
  bytes: Uint8Array;
}

export interface ExportFiles {
  datev: Uint8Array;
  bb: Uint8Array;
  receipts: Uint8Array;
}

const REQUIRED_BB_COLUMNS = [
  "Datum",
  "Betrag",
  "Sollkonto",
  "Habenkonto",
  "Steuerschlüssel",
  "Buchungsnummer",
  "Rechnungsnummern",
  "Gegenpartei",
  "Umsatzsteuer",
  "Beleglinks",
] as const;

export function readBbRows(bytes: Uint8Array): BuchhaltungsbutlerRow[] {
  const rows = parseCsv(decodeText(bytes), ";").filter((row) => row.some((field) => field.trim() !== ""));
  const titles = rows.shift()?.map((title) => title.trim()) ?? [];
  for (const required of REQUIRED_BB_COLUMNS) {
    if (!titles.includes(required)) throw new BuchhaltungsbutlerError(`BB Standardexport: Spalte „${required}“ fehlt.`);
  }
  return rows.map((fields, index) => {
    if (fields.length > titles.length) throw new BuchhaltungsbutlerError(`BB Standardexport, Zeile ${index + 2}: mehr Felder als Spalten.`);
    const row: BuchhaltungsbutlerRow = { __row: String(index + 2) };
    titles.forEach((title, i) => {
      if (title) row[title] = (fields[i] ?? "").trim();
    });
    return row;
  });
}

export function readReceiptFiles(bytes: Uint8Array): Map<string, BuchhaltungsbutlerFile[]> {
  const files = unzip(bytes, "Belege.zip");
  const result = new Map<string, BuchhaltungsbutlerFile[]>();
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    const filename = path.split("/").pop()!;
    const match = /^(\d+)(?:_(\d+))?\.(pdf|xml)$/i.exec(filename);
    if (!match) throw new BuchhaltungsbutlerError(`Belege.zip: Dateiname „${path}“ passt nicht zu <Buchungsnummer>.pdf/.xml oder <Buchungsnummer>_<lfd>.pdf/.xml.`);
    const role = match[3]!.toLowerCase() === "xml" ? "xml" : "pdf";
    if (role === "pdf" && (content.subarray(0, 5).length !== 5 || new TextDecoder().decode(content.subarray(0, 5)) !== "%PDF-")) {
      throw new BuchhaltungsbutlerError(`Belege.zip: ${path} ist keine PDF-Datei.`);
    }
    if (role === "xml" && !new TextDecoder().decode(content.subarray(0, 200)).trimStart().startsWith("<")) {
      throw new BuchhaltungsbutlerError(`Belege.zip: ${path} ist keine XML-Datei.`);
    }
    const bookingId = String(Number(match[1]));
    const list = result.get(bookingId) ?? [];
    list.push({ filename, bytes: content, role });
    result.set(bookingId, list);
  }
  for (const list of result.values()) list.sort((a, b) => a.filename.localeCompare(b.filename, "de", { numeric: true }));
  return result;
}

export function readExportFiles(parts: ExportPart[]): ExportFiles {
  const files: ExportPart[] = [];
  for (const part of parts) {
    const lower = part.name.toLowerCase();
    if (lower.endsWith(".zip") && !lower.endsWith("belege.zip")) {
      for (const [name, bytes] of Object.entries(unzip(part.bytes, part.name))) files.push({ name, bytes });
    } else {
      files.push(part);
    }
  }
  const datev = uniqueFile(files, (name) => name.startsWith("extf_") && name.endsWith("_buchungsstapel.csv"), "EXTF-Buchungsstapel");
  const bb = uniqueFile(files, (name) => name.startsWith("bb_") && name.endsWith(".csv"), "BB Standardexport");
  const receipts = uniqueFile(files, (name) => name.endsWith("belege.zip"), "Belege.zip");
  return { datev, bb, receipts };
}

function uniqueFile(parts: ExportPart[], matches: (name: string) => boolean, label: string): Uint8Array {
  const found = parts.filter((part) => matches(part.name.toLowerCase()));
  if (found.length !== 1) throw new BuchhaltungsbutlerError(`${label}: erwartet genau eine Datei, gefunden ${found.length}.`);
  return found[0]!.bytes;
}

function unzip(bytes: Uint8Array, name: string): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch (error) {
    throw new BuchhaltungsbutlerError(`${name}: ZIP-Datei kann nicht gelesen werden (${error instanceof Error ? error.message : String(error)}).`);
  }
}
