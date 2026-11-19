import { ciiXml } from "./cii.ts";
import { toEInvoiceData } from "./daten.ts";
import { renderInvoicePdf } from "./pdf.ts";
import type { InvoiceDocument } from "./types.ts";
import { ublXml } from "./ubl.ts";
import { validateForFormat } from "./validate.ts";
import { embedFacturX } from "./zugferd.ts";

export { netUnitPrice } from "./daten-werte.ts";
export { toEInvoiceData } from "./daten.ts";

/**
 * Erzeugt die E-Rechnung im gewünschten Format.
 * zugferd: pdf ist das PDF/A-3 mit eingebettetem factur-x.xml, xml das CII daraus.
 * xrechnung-*: xml ist die Rechnung, pdf die Sichtkopie.
 */
export async function buildEInvoice(doc: InvoiceDocument): Promise<{ xml: string; pdf: Uint8Array }> {
  const problems = validateForFormat(doc);
  if (problems.length > 0) {
    throw new Error(`Rechnung ${doc.number} unvollständig: ${problems.join("; ")}`);
  }
  const data = toEInvoiceData(doc);
  const visual = renderInvoicePdf(doc);

  if (doc.format === "zugferd") {
    const xml = ciiXml(data, "factur-x");
    return { xml, pdf: await embedFacturX(visual, xml, doc.issueDate) };
  }
  if (doc.format === "xrechnung-cii") return { xml: ciiXml(data, "xrechnung"), pdf: visual };
  return { xml: ublXml(data), pdf: visual };
}
