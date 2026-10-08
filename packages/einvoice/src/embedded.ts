import { inflateSync } from "node:zlib";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";

// Bekannte Dateinamen der Rechnungs-XML in hybriden PDFs, in dieser Reihenfolge bevorzugt
const KNOWN_NAMES = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml"];

interface Attachment {
  filename: string;
  spec: PDFDict;
}

/**
 * Sucht die eingebettete Rechnungs-XML in einem PDF (ZUGFeRD 1/2, Factur-X,
 * XRechnung als Anhang). Gibt null zurück, wenn das PDF keine XML-Anlage hat
 * oder nicht gelesen werden kann.
 */
export async function extractEmbeddedXml(pdf: Uint8Array): Promise<{ filename: string; xml: string } | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return null;
  }
  const attachments = collectAttachments(doc);
  const ranked = [
    ...KNOWN_NAMES.flatMap((name) => attachments.filter((a) => a.filename.toLowerCase() === name)),
    ...attachments.filter((a) => a.filename.toLowerCase().endsWith(".xml") || isXmlSubtype(a.spec, doc.context)),
  ];
  for (const attachment of ranked) {
    const bytes = embeddedBytes(attachment.spec, doc.context);
    if (!bytes) continue;
    const xml = decodeXmlBytes(bytes);
    if (xml.trimStart().startsWith("<")) return { filename: attachment.filename, xml };
  }
  return null;
}

function collectAttachments(doc: PDFDocument): Attachment[] {
  const { context, catalog } = doc;
  const specs: PDFDict[] = [];
  const add = (obj: PDFObject | undefined) => {
    const spec = obj && context.lookup(obj);
    if (spec instanceof PDFDict && !specs.includes(spec)) specs.push(spec);
  };

  // 1. Namensbaum /Names /EmbeddedFiles (mit /Kids)
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const tree = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const seen = new Set<PDFDict>();
  const walk = (node: PDFDict | undefined) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const pairs = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (pairs) for (let i = 1; i < pairs.size(); i += 2) add(pairs.get(i));
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookupMaybe(i, PDFDict));
  };
  walk(tree);

  // 2. /AF des Katalogs (PDF/A-3)
  const af = catalog.lookupMaybe(PDFName.of("AF"), PDFArray);
  if (af) for (let i = 0; i < af.size(); i++) add(af.get(i));

  // 3. Notfalls jede Dateispezifikation mit eingebetteter Datei
  if (specs.length === 0) {
    for (const [, obj] of context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.has(PDFName.of("EF"))) add(obj);
    }
  }

  return specs.map((spec) => ({ spec, filename: specName(spec) }));
}

function specName(spec: PDFDict): string {
  for (const key of ["UF", "F"]) {
    const value = spec.lookup(PDFName.of(key));
    if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText().trim();
  }
  return "";
}

function embeddedFile(spec: PDFDict, context: PDFContext): PDFRawStream | undefined {
  const ef = spec.lookupMaybe(PDFName.of("EF"), PDFDict);
  for (const key of ["F", "UF"]) {
    const ref = ef?.get(PDFName.of(key));
    const stream = ref && context.lookup(ref);
    if (stream instanceof PDFRawStream) return stream;
  }
  return undefined;
}

function isXmlSubtype(spec: PDFDict, context: PDFContext): boolean {
  const subtype = embeddedFile(spec, context)?.dict.lookup(PDFName.of("Subtype"));
  return subtype instanceof PDFName && /xml/i.test(subtype.decodeText());
}

/** Obergrenze für eine entpackte Anlage: ein kleiner Upload darf nicht Gigabytes entpacken (Deflate-Bombe) */
export const MAX_EMBEDDED_BYTES = 32 * 1024 * 1024;

function embeddedBytes(spec: PDFDict, context: PDFContext): Uint8Array | null {
  const stream = embeddedFile(spec, context);
  if (!stream) return null;
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray().map((f) => context.lookup(f)) : filter ? [filter] : [];
  if (filters.length === 0) return stream.contents;
  if (filters.length > 1 || filters[0] !== PDFName.of("FlateDecode")) {
    // seltene Filter (LZW, ASCII85 …) stückweise lesen und beim Limit abbrechen
    try {
      const decoded = decodePDFRawStream(stream);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (let chunk = decoded.getBytes(65_536); chunk.length > 0; chunk = decoded.getBytes(65_536)) {
        total += chunk.length;
        if (total > MAX_EMBEDDED_BYTES) return null;
        chunks.push(chunk as Uint8Array);
      }
      return Buffer.concat(chunks);
    } catch {
      // kaputter Filtereintrag: Flate versuchen
    }
  }
  // Flate über zlib mit Größenlimit (pdf-libs Decoder kennt keins); Prädiktoren kommen bei XML-Anlagen nicht vor
  try {
    return inflateSync(stream.contents, { maxOutputLength: MAX_EMBEDDED_BYTES });
  } catch {
    return null;
  }
}

/** UTF-8 (mit oder ohne BOM), UTF-16 mit BOM oder laut XML-Deklaration ISO-8859-1 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const encoding = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  if (encoding && encoding !== "utf-8" && encoding !== "utf8") {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      // unbekannte Kodierung: UTF-8 versuchen
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}
