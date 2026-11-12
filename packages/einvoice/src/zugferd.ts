import { inflateSync } from "node:zlib";
import { AFRelationship, decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

/*
 * ZUGFeRD/Factur-X: das CII als factur-x.xml im PDF/A-3 (Factur-X 1.07 / ZUGFeRD 2.3, Kapitel „Hybrid-PDF“). Das PDF
 * aus Typst ist schon PDF/A-3b mit XMP; dazu kommen der Anhang mit AFRelationship „Alternative“ (im Katalog unter
 * /AF) und im XMP die Factur-X-Angaben samt Erweiterungsschema, das PDF/A für eigene Namensräume verlangt.
 */

const FX_NAMESPACE = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";
export const FACTUR_X_FILENAME = "factur-x.xml";

/** Erweiterungsschema für fx (PDF/A-3, ISO 19005-3, 6.6.2.3), wie es die Factur-X-Spezifikation vorgibt */
const FX_SCHEMA = [
  '<rdf:li rdf:parseType="Resource">',
  "<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>",
  `<pdfaSchema:namespaceURI>${FX_NAMESPACE}</pdfaSchema:namespaceURI>`,
  "<pdfaSchema:prefix>fx</pdfaSchema:prefix>",
  "<pdfaSchema:property><rdf:Seq>",
  ...[
    ["DocumentFileName", "The name of the embedded XML document"],
    ["DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER"],
    ["Version", "The actual version of the standard applying to the embedded XML document"],
    ["ConformanceLevel", "The conformance level of the embedded XML document"],
  ].map(
    ([name, description]) =>
      `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`,
  ),
  "</rdf:Seq></pdfaSchema:property>",
  "</rdf:li>",
].join("");

/** Die Factur-X-Angaben: Profil EN 16931, Version 1.0 */
const FX_DESCRIPTION = [
  `<rdf:Description rdf:about="" xmlns:fx="${FX_NAMESPACE}">`,
  "<fx:DocumentType>INVOICE</fx:DocumentType>",
  `<fx:DocumentFileName>${FACTUR_X_FILENAME}</fx:DocumentFileName>`,
  "<fx:Version>1.0</fx:Version>",
  "<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>",
  "</rdf:Description>",
].join("");

/** XMP des Typst-PDF um Erweiterungsschema und Factur-X-Angaben ergänzt */
function withFacturX(xmp: string): string {
  const bag = "<pdfaExtension:schemas><rdf:Bag>";
  if (!xmp.includes(bag) || !xmp.includes("</rdf:RDF>")) throw new Error("XMP des Rechnungs-PDF ohne PDF/A-Erweiterungsschemas");
  return xmp.replace(bag, `${bag}${FX_SCHEMA}`).replace("</rdf:RDF>", `${FX_DESCRIPTION}</rdf:RDF>`);
}

/**
 * Bettet das CII in das PDF/A-3b aus Typst ein. date ist das Rechnungsdatum: wie Typst setzt es auch die Zeitstempel
 * des Anhangs, dieselbe Rechnung ergibt also dasselbe PDF.
 */
export async function embedFacturX(visual: Uint8Array, xml: string, date: string): Promise<Uint8Array> {
  // updateMetadata: false, sonst setzt pdf-lib Producer und Datum im Info-Verzeichnis anders als im XMP
  const pdf = await PDFDocument.load(visual, { updateMetadata: false });
  const metadata = pdf.catalog.lookup(PDFName.of("Metadata"));
  if (!(metadata instanceof PDFRawStream)) throw new Error("Rechnungs-PDF ohne XMP-Metadaten");
  const xmp = withFacturX(new TextDecoder().decode(decodePDFRawStream(metadata).decode()));
  const bytes = new TextEncoder().encode(xmp);
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(pdf.context.stream(bytes, { Type: "Metadata", Subtype: "XML" })));

  const timestamp = new Date(`${date}T12:00:00Z`);
  await pdf.attach(new TextEncoder().encode(xml), FACTUR_X_FILENAME, {
    mimeType: "text/xml",
    description: "Factur-X",
    creationDate: timestamp,
    modificationDate: timestamp,
    afRelationship: AFRelationship.Alternative,
  });
  // Ohne Objektströme: Namensbaum und Dateiangaben bleiben für einfache Leser (wie extractFacturXXml) im Klartext
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/**
 * Liest die eingebettete XML-Datei (factur-x.xml) aus einem ZUGFeRD-PDF.
 * Bewusst minimal: erwartet genau einen Anhang vom Typ text/xml, wie ihn embedFacturX schreibt.
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
