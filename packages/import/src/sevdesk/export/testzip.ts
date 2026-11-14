import { readFileSync } from "node:fs";
import { strToU8, zipSync, type Zippable } from "fflate";

/*
 * Baut für die Tests eine Export-ZIP „Buchungsdaten & Belegbilder“ aus den Testdaten unter
 * test-fixtures/sevdesk: Stapel und Stammdaten als CSV, je Richtung eine innere ZIP mit document.xml
 * und einer erfundenen PDF je Dateiname. Die Testdaten selbst bleiben byte-gleich.
 */

const FIXTURES = new URL("../../../test-fixtures/sevdesk/", import.meta.url);

export const fixture = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, FIXTURES)));

/** Inhalt der erfundenen Belegdatei; der Test erkennt sie am Namen wieder */
export const pdfBytes = (name: string): Uint8Array => strToU8(`%PDF-1.4 ${name}`);

/** Dateinamen aus `<extension name="…">` */
export const fileNamesOf = (xml: Uint8Array): string[] => [...new TextDecoder().decode(xml).matchAll(/<extension name="([^"]+)"/g)].map((m) => m[1]!);

/** Innere ZIP wie `DATEV_Rechnungsausgang_….zip`; `omit` lässt Dateien weg */
export function innerZip(xml: Uint8Array, omit: string[] = []): Uint8Array {
  const files: Zippable = { "document.xml": xml };
  for (const name of fileNamesOf(xml)) if (!omit.includes(name)) files[name] = pdfBytes(name);
  return zipSync(files);
}

/**
 * In `buchhaltung-1.0/` ist die Kopfzeile maskiert: Wirtschaftsjahr und Zeitraum 11111111, Sachkontenlänge 1.
 * Der Test setzt 2024 und Länge 4 ein, der Rest der Datei bleibt Byte für Byte (Windows-1252, CRLF).
 */
export function unmaskedStack10(): Uint8Array {
  const text = Buffer.from(fixture("buchhaltung-1.0/extf-buchungsstapel.csv")).toString("latin1");
  const masked = "11111;1111;11111111;1;11111111;11111111;";
  if (!text.startsWith(`EXTF;700;21;Buchungsstapel;13;;;;;;${masked}`)) throw new Error("Kopfzeile der Testdaten 1.0 hat sich geändert");
  return new Uint8Array(Buffer.from(text.replace(masked, "11111;1111;20240101;4;20240101;20241231;"), "latin1"));
}

export const zip = (entries: Zippable): Uint8Array => zipSync(entries);
