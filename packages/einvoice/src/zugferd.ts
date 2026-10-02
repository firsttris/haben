import { inflateSync } from "node:zlib";

/**
 * Liest die eingebettete XML-Datei (factur-x.xml) aus einem ZUGFeRD-PDF.
 * Bewusst minimal: erwartet genau einen Anhang vom Typ text/xml, wie ihn
 * e-invoice-eu schreibt.
 */
export function extractFacturXXml(pdf: Uint8Array): string | null {
  const raw = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const text = raw.toString("latin1");
  const head = /\/Type\s*\/EmbeddedFile\b[\s\S]*?\/Subtype\s*\/text#2Fxml[\s\S]*?stream\r?\n/.exec(text);
  if (!head) return null;
  const dict = head[0];
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  const start = head.index + dict.length;
  const end = length ? start + Number(length[1]) : text.slice(0, text.indexOf("endstream", start)).trimEnd().length;
  const body = raw.subarray(start, end);
  const data = /\/Filter\s*\/FlateDecode/.test(dict) ? inflateSync(body) : body;
  return data.toString("utf8");
}
