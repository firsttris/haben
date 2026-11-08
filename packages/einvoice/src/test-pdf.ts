import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFRawStream } from "pdf-lib";

/*
 * Für Tests: Wo der Entwurfsvermerk (templates/entwurf.typ) auf jeder Seite eines PDFs steht. Typst setzt ihn mit
 * eigener Deckung (ExtGState /ca 38/255); im Inhaltsstrom zeigt die Stelle des „gs“-Befehls, ob er vor dem Inhalt
 * (Hintergrund, verdeckbar) oder nach ihm (Vordergrund) gezeichnet wird.
 */

const DRAFT_OPACITY = 38 / 255;

export interface DraftLayer {
  /** Die Seite hat den Vermerk */
  marked: boolean;
  /** Der Vermerk wird nach dem ersten Text der Seite gezeichnet, liegt also über dem Inhalt */
  overContent: boolean;
}

export async function draftLayers(pdf: Uint8Array): Promise<DraftLayer[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page) => {
    const states = page.node.Resources()?.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
    const names = (states?.entries() ?? [])
      .filter(([, ref]) => {
        const opacity = doc.context.lookupMaybe(ref, PDFDict)?.lookupMaybe(PDFName.of("ca"), PDFNumber);
        return opacity !== undefined && Math.abs(opacity.asNumber() - DRAFT_OPACITY) < 0.001;
      })
      .map(([name]) => name.toString());
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString("latin1")).join("\n");
    const at = names.map((name) => ops.indexOf(`${name} gs`)).filter((i) => i >= 0);
    const firstText = ops.search(/T[Jj]\b/);
    return { marked: at.length > 0, overContent: at.length > 0 && firstText >= 0 && Math.min(...at) > firstText };
  });
}
