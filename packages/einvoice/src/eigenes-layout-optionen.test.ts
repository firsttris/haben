import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";

/*
 * Feldvertrag (layout-schema.ts): look.options sind die Optionen eines eingebauten Layouts, „leer bei eigenen Layouts“.
 * Ein eigenes Layout bekommt die Daten über pdfFrom; der Briefkopf trägt dann kein eingebautes Layout (withCustomLayout).
 */
describe("look.options für ein eigenes Layout", () => {
  it("ist leer, auch wenn das Standardlayout Klar in der Fassung „Klassisch“ ist", () => {
    let daten: { look: { options: unknown } } | undefined;
    renderInvoicePdf({
      ...sampleDocument(),
      pdfFrom: (request) => {
        daten = request.data as typeof daten;
        return new Uint8Array([37, 80, 68, 70]);
      },
    });
    expect(daten?.look.options).toEqual({});
  });
});
