import type { LstbWerte } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildLstbAusdruckPdf, lstbAusdruckPdfData, type LstbAusdruckDocument } from "./lohnsteuerbescheinigung.ts";
import { draftLayers } from "./test-pdf.ts";

/** Ausdruck nach dem amtlichen Muster 2026 (BMF-Schreiben vom 29.8.2025): Zeilen, Kopf, Merkmale, Entwurf */

const werte: LstbWerte = {
  jahr: 2026,
  von: "2026-01-01",
  bis: "2026-06-30",
  bruttoarbeitslohn: 24_000_00,
  lohnsteuer: 2_706_00,
  soli: 0,
  kirchensteuer: 243_54,
  rvArbeitgeber: 2_232_00,
  rvArbeitnehmer: 2_232_00,
  kvArbeitnehmer: 2_124_00,
  pvArbeitnehmer: 432_00,
  avArbeitnehmer: 312_00,
  pkvBasis: null,
  merkmale: [
    { gueltigAb: "2026-01-01", steuerklasse: 1, faktor: 1000, kinderfreibetraege: 0, konfession: "ev" },
    { gueltigAb: "2026-04-01", steuerklasse: 3, faktor: 1000, kinderfreibetraege: 1500, konfession: null },
  ],
};

const doc: LstbAusdruckDocument = {
  werte,
  angaben: {
    arbeitnehmer: {
      idnr: "86095742719",
      ordnungsmerkmal: "7",
      vorname: "Max",
      nachname: "Beispiel",
      geburtsdatum: "1985-03-27",
      strasse: "Lindenweg 1",
      plz: "28195",
      ort: "Bremen",
    },
    arbeitgeber: {
      name: "Nordlicht Software GmbH",
      steuernummer13: "2460014512345",
      finanzamt: "Finanzamt Bremen",
      strasse: "Hafenallee 3",
      plz: "28217",
      ort: "Bremen",
    },
  },
  uebermittlung: { datum: "2026-07-03", transferTicket: "et0123456789", korrektur: true, storniert: false },
  heute: "2026-07-03",
};

describe("lstbAusdruckPdfData", () => {
  const d = lstbAusdruckPdfData(doc);
  const zeile = (nr: string) => d.zeilen.find((z) => z.nr === nr);

  it("Titel und Kopf wie im Muster, mit Transferticket und Korrektur", () => {
    expect(d.title).toBe("Ausdruck der elektronischen Lohnsteuerbescheinigung für 2026");
    expect(d.untertitel).toBe("Nachstehende Daten wurden maschinell an die Finanzverwaltung übermittelt.");
    expect(d.entwurf).toBeNull();
    expect(d.kopf).toEqual([
      { label: "Korrektur:", value: "ja" },
      { label: "Stornierung:", value: "" },
      { label: "Datum:", value: "03.07.2026" },
      { label: "Identifikationsnummer:", value: "86095742719" },
      { label: "Personalnummer:", value: "7" },
      { label: "Geburtsdatum:", value: "27.03.1985" },
      { label: "Transferticket:", value: "et0123456789" },
    ]);
    expect(d.finanzamt).toBe("Finanzamt Bremen (2460)");
  });

  it("Zeilen 1 bis 34 mit Beträgen, leer, was Haben nicht abrechnet; Zeile 28 ab 2026 unbesetzt", () => {
    expect(d.zeilen).toHaveLength(40);
    expect(zeile("1.")?.wert).toBe("01.01. – 30.06.");
    expect(zeile("3.")?.wert).toBe("24.000,00");
    expect(zeile("4.")?.wert).toBe("2.706,00");
    expect(zeile("5.")?.wert).toBe("0,00");
    expect(zeile("6.")?.wert).toBe("243,54");
    expect(zeile("22. a)")?.wert).toBe("2.232,00");
    expect(zeile("23. a)")?.wert).toBe("2.232,00");
    expect(zeile("24. a)")?.wert).toBe("");
    expect([zeile("25.")?.wert, zeile("26.")?.wert, zeile("27.")?.wert]).toEqual(["2.124,00", "432,00", "312,00"]);
    expect(zeile("28.")?.text).toBe("unbesetzt");
  });

  it("Merkmale des letzten Lohnzahlungszeitraums, Änderungen im Jahr als Hinweis", () => {
    expect(d.merkmale.slice(0, 2)).toEqual([
      { label: "Steuerklasse/Faktor", value: "3" },
      { label: "Zahl der Kinderfreibeträge", value: "1,5" },
    ]);
    expect(d.merkmale.find((m) => m.label === "Kirchensteuermerkmale")?.value).toBe("--");
    expect(d.merkmaleHinweis).toContain("ab 01.04.2026 Steuerklasse 3");
  });

  it("privater Basisbeitrag: ab 2026 links als Monatsbetrag, bis 2025 in Zeile 28 als Jahressumme", () => {
    const pkv = { ...werte, pkvBasis: { letzterMonat: 650_00, jahr: 3_900_00 } };
    expect(lstbAusdruckPdfData({ ...doc, werte: pkv }).merkmale.at(-1)?.value).toBe("650,00");
    const d2025 = lstbAusdruckPdfData({ ...doc, werte: { ...pkv, jahr: 2025 } });
    expect(d2025.zeilen.find((z) => z.nr === "28.")).toEqual({
      nr: "28.",
      text: "Beiträge zur privaten Kranken- und Pflege-Pflichtversicherung",
      wert: "3.900,00",
    });
  });

  it("vor der Übermittlung nur ein Entwurf", () => {
    const e = lstbAusdruckPdfData({ ...doc, uebermittlung: null });
    expect(e.untertitel).toBeNull();
    expect(e.entwurf).toContain("noch nicht an die Finanzverwaltung übermittelt");
    expect(e.kopf.find((k) => k.label === "Transferticket:")?.value).toBe("");
  });

  it("erzeugt ein PDF/A-3b, auch als Entwurf", () => {
    expect(Buffer.from(buildLstbAusdruckPdf(doc)).toString("latin1").slice(0, 5)).toBe("%PDF-");
    expect(
      Buffer.from(buildLstbAusdruckPdf({ ...doc, uebermittlung: null }))
        .toString("latin1")
        .slice(0, 5),
    ).toBe("%PDF-");
  });

  it("der Entwurf trägt den Vermerk über dem Inhalt, der übermittelte Ausdruck keinen", async () => {
    expect((await draftLayers(buildLstbAusdruckPdf({ ...doc, uebermittlung: null }))).every((l) => l.marked && l.overContent)).toBe(true);
    expect((await draftLayers(buildLstbAusdruckPdf(doc))).some((l) => l.marked)).toBe(false);
  });
});
