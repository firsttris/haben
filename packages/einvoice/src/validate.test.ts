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
    expect(validateForFormat({ ...sampleDocument({ kind: "storno" }), corrects: undefined })).toEqual([
      "Bezug zur ursprünglichen Rechnung fehlt",
    ]);
  });
});
