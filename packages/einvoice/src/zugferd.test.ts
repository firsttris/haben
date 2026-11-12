import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";
import { embedFacturX, extractFacturXXml } from "./zugferd.ts";

async function load(pdf: Uint8Array) {
  return PDFDocument.load(pdf, { updateMetadata: false });
}

function rawStream(value: unknown): PDFRawStream {
  if (!(value instanceof PDFRawStream)) throw new Error("kein Datenstrom");
  return value;
}

function xmpOf(doc: PDFDocument): string {
  return new TextDecoder().decode(decodePDFRawStream(rawStream(doc.catalog.lookup(PDFName.of("Metadata")))).decode());
}

describe("ZUGFeRD-PDF", () => {
  it("ist für dieselbe Rechnung byte-gleich", async () => {
    const a = await buildEInvoice(sampleDocument());
    const b = await buildEInvoice(sampleDocument());
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true);
  });

  it("hängt factur-x.xml als Alternative an und führt es im Katalog unter /AF", async () => {
    const { xml, pdf } = await buildEInvoice(sampleDocument());
    const doc = await load(pdf);
    const af = doc.catalog.lookup(PDFName.of("AF"), PDFArray);
    expect(af.size()).toBe(1);
    const spec = af.lookup(0, PDFDict);
    expect(spec.get(PDFName.of("AFRelationship"))).toBe(PDFName.of("Alternative"));
    expect(spec.lookup(PDFName.of("UF"))?.toString()).toContain("FEFF006600610063007400750072002D0078002E0078006D006C");
    const file = rawStream(spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F")));
    expect(file.dict.get(PDFName.of("Subtype"))).toBe(PDFName.of("text/xml"));
    expect(new TextDecoder().decode(decodePDFRawStream(file).decode())).toBe(xml);
    expect(extractFacturXXml(pdf)).toBe(xml);
  });

  it("ergänzt das XMP aus Typst um das Factur-X-Schema und die Angaben zum Profil EN 16931", async () => {
    const { pdf } = await buildEInvoice(sampleDocument());
    const xmp = xmpOf(await load(pdf));
    // PDF/A-3b und die Erweiterungsschemas von Typst bleiben
    expect(xmp).toContain("<pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>");
    expect(xmp).toContain("<pdfaSchema:prefix>xmpMM</pdfaSchema:prefix>");
    // Das fx-Schema steht in derselben Liste der Erweiterungsschemas, jede Eigenschaft beschrieben
    const schemas = /<pdfaExtension:schemas><rdf:Bag>([\s\S]*?)<\/rdf:Bag><\/pdfaExtension:schemas>/.exec(xmp)?.[1] ?? "";
    expect(schemas).toContain("<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>");
    for (const name of ["DocumentFileName", "DocumentType", "Version", "ConformanceLevel"]) {
      expect(schemas).toContain(`<pdfaProperty:name>${name}</pdfaProperty:name>`);
    }
    expect(xmp).toMatch(
      /<fx:DocumentType>INVOICE<\/fx:DocumentType><fx:DocumentFileName>factur-x\.xml<\/fx:DocumentFileName><fx:Version>1\.0<\/fx:Version><fx:ConformanceLevel>EN 16931<\/fx:ConformanceLevel>/,
    );
    // Zeitstempel aus dem Rechnungsdatum, nicht aus der Uhr
    expect(xmp).toContain("<xmp:CreateDate>2026-10-02T12:00:00+00:00</xmp:CreateDate>");
  });

  it("bricht ab, wenn dem PDF das XMP oder dessen Erweiterungsschemas fehlen", async () => {
    const ohneXmp = await PDFDocument.create();
    ohneXmp.addPage();
    await expect(embedFacturX(await ohneXmp.save(), "<x/>", "2026-10-02")).rejects.toThrow("Rechnungs-PDF ohne XMP-Metadaten");

    const ohneSchemas = await PDFDocument.create();
    ohneSchemas.addPage();
    const xmp = new TextEncoder().encode(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>',
    );
    ohneSchemas.catalog.set(PDFName.of("Metadata"), ohneSchemas.context.register(ohneSchemas.context.stream(xmp, { Type: "Metadata", Subtype: "XML" })));
    await expect(embedFacturX(await ohneSchemas.save(), "<x/>", "2026-10-02")).rejects.toThrow("XMP des Rechnungs-PDF ohne PDF/A-Erweiterungsschemas");
  });
});
