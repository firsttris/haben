import { describe, expect, it } from "vitest";
import { validateForFormat } from "./validate.ts";
import { sampleDocument, sampleSeller } from "./samples.ts";

describe("validateForFormat", () => {
  it("akzeptiert vollständige Rechnungen in allen Formaten", () => {
    for (const format of ["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const) {
      expect(validateForFormat(sampleDocument({ format }))).toEqual([]);
    }
  });

  it("verlangt Telefon und Kundenadresse nur für XRechnung", () => {
    const doc = sampleDocument();
    doc.seller = { ...sampleSeller, telefon: undefined };
    doc.buyer = { ...doc.buyer, email: undefined };
    expect(validateForFormat(doc)).toEqual([]);
    expect(validateForFormat({ ...doc, format: "xrechnung-ubl" })).toEqual([
      "Telefonnummer fehlt (für XRechnung Pflicht)",
      "E-Mail-Adresse oder Leitweg-ID des Kunden fehlt (für XRechnung Pflicht)",
    ]);
  });

  it("meldet fehlende Steuernummer, IBAN und Rechnungsbezug", () => {
    const doc = sampleDocument();
    doc.seller = { ...sampleSeller, steuernummer: undefined, ustId: " ", iban: undefined };
    expect(validateForFormat(doc)).toEqual(["Steuernummer oder USt-IdNr. fehlt", "IBAN fehlt"]);
    expect(validateForFormat({ ...sampleDocument({ kind: "storno" }), corrects: undefined })).toEqual(["Bezug zur ursprünglichen Rechnung fehlt"]);
  });

  // Codelisten nach EN 16931 (ISO 3166-1 mit 1A für Kosovo und XI für Nordirland, ISO 4217); bis #734 lehnte
  // @e-invoice-eu/core unbekannte Codes beim Erzeugen ab
  it("meldet Länder- und Währungscodes, die EN 16931 nicht kennt", () => {
    const doc = sampleDocument();
    expect(validateForFormat({ ...doc, buyer: { ...doc.buyer, land: "XX" } })).toEqual(["Ländercode des Kunden „XX“ unbekannt"]);
    expect(validateForFormat({ ...doc, buyer: { ...doc.buyer, land: "XK" } })).toEqual(["Ländercode des Kunden „XK“ unbekannt"]);
    expect(validateForFormat({ ...doc, seller: { ...sampleSeller, land: "D" } })).toEqual(["Ländercode des Rechnungsstellers „D“ unbekannt"]);
    expect(validateForFormat({ ...doc, currency: "ABC" })).toEqual(["Währung „ABC“ unbekannt"]);
    expect(validateForFormat({ ...doc, buyer: { ...doc.buyer, land: "1A" }, currency: "CHF" })).toEqual([]);
    expect(validateForFormat({ ...doc, buyer: { ...doc.buyer, land: "XI" } })).toEqual([]);
  });
});
