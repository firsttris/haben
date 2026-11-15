import { XMLParser } from "fast-xml-parser";
import type { SevExportDirection, SevExportDocument } from "./types.ts";

/*
 * `document.xml` im Namensraum http://xml.datev.de/bedi/tps/document/v06.0. Die Spezifikation ist nicht öffentlich;
 * der Aufbau ist an den Testdaten belegt (test-fixtures/sevdesk, beide Buchhaltungsversionen):
 * `<archive generatingSystem="sevDesk"><content><document guid="…" type="1|2"><extension name="…" xsi:type="File"/>`.
 */

export type DocumentXml = { ok: true; documents: SevExportDocument[]; hints: string[] } | { ok: false; reason: string };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true });

const asArray = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null);

/** `type` 1 ist Rechnungseingang, 2 Rechnungsausgang; fehlt er, sagt es der Name der inneren ZIP */
function directionOf(type: string | null, archive: string): SevExportDirection | null {
  if (type === "1") return "eingang";
  if (type === "2") return "ausgang";
  if (/rechnungseingang/i.test(archive)) return "eingang";
  if (/rechnungsausgang/i.test(archive)) return "ausgang";
  return null;
}

export function parseDocumentXml(bytes: Uint8Array, archive: string): DocumentXml {
  let parsed: unknown;
  try {
    parsed = parser.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return { ok: false, reason: `${archive}: document.xml ist kein gültiges XML.` };
  }
  const root = record(record(parsed).archive);
  const system = text(root.generatingSystem);
  if (system !== null && system !== "sevDesk") {
    return { ok: false, reason: `${archive}: document.xml ist erzeugt von „${system}“, nicht von sevDesk.` };
  }
  const documents: SevExportDocument[] = [];
  const hints: string[] = [];
  for (const node of asArray(record(root.content).document)) {
    const element = record(node);
    const guid = text(element.guid);
    const fileName = text(record(asArray(element.extension)[0]).name);
    if (!guid || !fileName) {
      hints.push(`${archive}: Eintrag in document.xml ohne GUID oder Dateiname übersprungen.`);
      continue;
    }
    documents.push({ guid, direction: directionOf(text(element.type), archive), fileName, archive, element });
  }
  return { ok: true, documents, hints };
}
