import { InvoiceService, type Invoice } from "@e-invoice-eu/core";
import Ajv2019 from "ajv/dist/2019.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEInvoice } from "./generate.ts";
import { renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { toEInvoiceData } from "./xml.ts";
import { extractFacturXXml } from "./zugferd.ts";

const logger = { log: () => {}, warn: () => {}, error: () => {} };
const library = new InvoiceService(logger);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateEInvoice", () => {
  // Gleiche Ausgabe wie InvoiceService.generate aus @e-invoice-eu/core; schlägt fehl, wenn ein Update der Bibliothek
  // generate ändert und generate.ts nachgezogen werden muss
  it.each(["XRECHNUNG-CII", "XRECHNUNG-UBL"])("%s: dasselbe XML wie die Bibliothek", async (format) => {
    const data = toEInvoiceData(sampleDocument({ format: format === "XRECHNUNG-CII" ? "xrechnung-cii" : "xrechnung-ubl" }));
    const erwartet = await library.generate(structuredClone(data), { format, lang: "de-de", noWarnings: true });
    expect(await generateEInvoice(structuredClone(data), { format, lang: "de-de", noWarnings: true })).toBe(erwartet);
  });

  it("Factur-X: dasselbe eingebettete XML wie die Bibliothek", async () => {
    const doc = sampleDocument();
    const data = toEInvoiceData(doc);
    const options = () => ({
      format: "Factur-X-EN16931",
      lang: "de-de",
      noWarnings: true,
      pdf: { buffer: renderInvoicePdf(doc), filename: "r.pdf", mimetype: "application/pdf" },
    });
    const erwartet = await library.generate(structuredClone(data), options());
    const pdf = await generateEInvoice(structuredClone(data), options());
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(extractFacturXXml(pdf as Uint8Array)).toBe(extractFacturXXml(erwartet as Uint8Array));
  });

  it("lehnt ungültige Daten mit derselben Meldung ab wie die Bibliothek", async () => {
    const data = toEInvoiceData(sampleDocument({ format: "xrechnung-cii" }));
    const kaputt = { ...data, "ubl:Invoice": { ...data["ubl:Invoice"], "cbc:ID": 42 } } as unknown as Invoice;
    const options = { format: "XRECHNUNG-CII", lang: "de-de", noWarnings: true };
    const erwartet = await library.generate(structuredClone(kaputt), { ...options }).catch((e: Error) => e.message);
    await expect(generateEInvoice(structuredClone(kaputt), { ...options })).rejects.toThrow(erwartet as string);
  });

  // Das Schema zu kompilieren kostet rund 250 ms; die Bibliothek tut es bei jedem Aufruf
  it("kompiliert das Schema je Format nur einmal", async () => {
    const compile = vi.spyOn(Ajv2019.prototype, "compile");
    const data = toEInvoiceData(sampleDocument({ format: "xrechnung-ubl" }));
    for (let i = 0; i < 3; i++) await generateEInvoice(structuredClone(data), { format: "XRECHNUNG-UBL", lang: "de-de", noWarnings: true });
    expect(compile.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
