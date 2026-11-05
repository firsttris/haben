import { lohnabrechnung, lohnkonto, type LohnStammdaten } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildLohnabrechnungPdf, type LohnabrechnungDocument, lohnabrechnungPdfData } from "./lohnabrechnung.ts";
import { buildLohnkontoPdf, lohnkontoPdfData } from "./lohnkonto.ts";

const GGF: LohnStammdaten = {
  art: "ggf",
  monatsgehalt: 6000_00,
  eintritt: "2024-01-01",
  austritt: null,
  steuerklasse: 1,
  faktor: 1000,
  kinderfreibetraege: 500,
  konfession: "ev",
  kv: { art: "privat", basisbeitrag: 600_00, arbeitgeberzuschuss: 0 },
  pflege: { kinderlosenzuschlag: false, kinderUnter25: 0 },
  umlagen: { u1: null, u2: 0 },
  minijob: { rvBefreit: false, pauschsteuer: true },
};

function dokument(stammdaten: LohnStammdaten, mehr: Partial<LohnabrechnungDocument> = {}): LohnabrechnungDocument {
  const r = lohnabrechnung({ jahr: 2026, monat: 10, stammdaten, bundesland: "HB" });
  if (!r.ok) throw new Error(r.meldung);
  return {
    arbeitgeber: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" },
    arbeitnehmer: {
      vorname: "Erika",
      nachname: "Muster",
      strasse: "Lindenweg 1",
      plz: "28195",
      ort: "Bremen",
      geburtsdatum: "1980-04-12",
      personalnummer: 1,
      steuerId: "86095742719",
      svNummer: "",
      iban: "DE89370400440532013000",
    },
    jahr: 2026,
    monat: 10,
    zahltag: "2026-10-28",
    ausgestellt: "2026-10-27",
    eintritt: stammdaten.eintritt,
    austritt: null,
    steuertage: r.steuertage,
    svTage: r.svTage,
    beschaeftigung: "Gesellschafter-Geschäftsführer ohne SV-Pflicht",
    steuer: { steuerklasse: 1, faktor: 1000, kinderfreibetraege: stammdaten.kinderfreibetraege, konfession: stammdaten.konfession ? "evangelisch" : null },
    sv:
      stammdaten.art === "ggf"
        ? null
        : { personengruppe: "109", beitragsgruppen: "6500", einzugsstelle: "Minijob-Zentrale", pflegeKennziffer: "–", uebergangsbereich: false },
    bestandteile: r.bestandteile,
    betraege: { ...r, zuschuss: 0 },
    entwurf: false,
    gegenpruefen: false,
    ...mehr,
  };
}

describe("Entgeltabrechnung als PDF (§ 108 GewO, EntgBV)", () => {
  it("ist als Bescheinigung nach § 108 Abs. 3 Satz 1 GewO gekennzeichnet (§ 1 Abs. 4 EntgBV)", () => {
    const data = lohnabrechnungPdfData(dokument(GGF));
    expect(data.kennzeichnung).toBe("Bescheinigung nach § 108 Absatz 3 Satz 1 der Gewerbeordnung");
    expect(data.title).toBe("Entgeltabrechnung Oktober 2026");
    expect(data.entwurf).toBeNull();
  });

  it("nennt Arbeitgeber, Beschäftigten mit Geburtsdatum, Beginn, Zeitraum, Steuer- und SV-Tage (§ 1 Abs. 1 Nr. 1 bis 6 EntgBV)", () => {
    const data = lohnabrechnungPdfData(dokument(GGF));
    expect(data.person).toEqual(
      expect.arrayContaining([
        { label: "Arbeitgeber", value: "Nordlicht Software GmbH, Hafenallee 3, 28217 Bremen" },
        { label: "Beschäftigte(r)", value: "Erika Muster, Lindenweg 1, 28195 Bremen" },
        { label: "Geburtsdatum", value: "12.04.1980" },
        { label: "Beschäftigt seit", value: "01.01.2024" },
        { label: "Steuertage, SV-Tage", value: "30, 0" },
      ]),
    );
    expect(data.meta).toContainEqual({ label: "Abrechnungszeitraum", value: "01.10.2026 – 31.10.2026" });
  });

  it("nennt Steuerklasse, Kinderfreibeträge, Kirchensteuermerkmal und Steuer-ID (§ 1 Abs. 1 Nr. 7 EntgBV)", () => {
    expect(lohnabrechnungPdfData(dokument(GGF)).steuer).toEqual([
      { label: "Steuer-ID", value: "86095742719" },
      { label: "Steuerklasse", value: "I" },
      { label: "Kinderfreibeträge", value: "0,5" },
      { label: "Kirchensteuermerkmal", value: "evangelisch" },
      { label: "Freibetrag, Hinzurechnungsbetrag", value: "keine" },
    ]);
  });

  it("Bezüge mit Art und Wirkung auf die Bruttoentgelte, Abzüge, Netto und Auszahlung (§ 1 Abs. 2 EntgBV)", () => {
    const data = lohnabrechnungPdfData(dokument(GGF));
    expect(data.bezuege).toEqual([{ label: "Geschäftsführergehalt", art: "laufend", steuer: "ja", sv: "nein", gesamt: "ja", value: "6.000,00 €" }]);
    expect(data.brutto.at(-1)).toEqual({ label: "Gesamtbrutto", value: "6.000,00 €" });
    expect(data.abzuege.map((z) => z.label)).toEqual(["Lohnsteuer", "Solidaritätszuschlag", "Kirchensteuer"]);
    expect(data.sv).toEqual([{ label: "Sozialversicherung", value: "keine Beiträge (Gesellschafter-Geschäftsführer ohne Versicherungspflicht)" }]);
    expect(data.auszahlung.label).toBe("Auszahlungsbetrag");
  });

  it("Minijob: pauschal besteuert, Abzug nur der RV-Anteil, Abgaben des Arbeitgebers zur Information", () => {
    const data = lohnabrechnungPdfData(
      dokument({ ...GGF, art: "minijob", monatsgehalt: 603_00, konfession: null, kv: { art: "gesetzlich", zusatzbeitrag: 0 } }),
    );
    expect(data.bezuege[0]).toMatchObject({ steuer: "pauschal", sv: "ja" });
    expect(data.abzuege).toEqual([{ label: "Rentenversicherung", value: "-21,71 €" }]);
    expect(data.brutto).toContainEqual({ label: "Pauschal besteuerte Bezüge (§ 40a Abs. 2 EStG)", value: "603,00 €" });
    expect(data.arbeitgeber).toContainEqual({ label: "Pauschsteuer (§ 40a Abs. 2 EStG)", value: "12,06 €" });
  });

  it("kennzeichnet Entwürfe, in Stufe C zum Gegenprüfen", () => {
    expect(lohnabrechnungPdfData(dokument(GGF, { entwurf: true })).entwurf).toBe("Entwurf – nicht festgeschrieben");
    expect(lohnabrechnungPdfData(dokument(GGF, { entwurf: true, gegenpruefen: true })).entwurf).toMatch(/gegenprüfen/);
  });

  it("erzeugt ein PDF/A-3b, auch als Entwurf", () => {
    for (const entwurf of [false, true]) {
      const text = Buffer.from(buildLohnabrechnungPdf(dokument(GGF, { entwurf }))).toString("latin1");
      expect(text.slice(0, 5)).toBe("%PDF-");
      expect(text).toContain("<pdfaid:part>3</pdfaid:part>");
    }
  });
});

describe("Lohnkonto als PDF", () => {
  const konto = lohnkonto(
    2026,
    {
      vorname: "Erika",
      nachname: "Muster",
      geburtsdatum: "1980-04-12",
      anschrift: ["Lindenweg 1", "28195 Bremen"],
      steuerId: "86095742719",
      personalnummer: "1",
      eintritt: "2024-01-01",
      austritt: null,
      merkmale: "Steuerklasse I, Kinderfreibeträge 0,5, evangelisch",
      sozialversicherung: "Gesellschafter-Geschäftsführer ohne SV-Pflicht",
    },
    [
      {
        zahltag: "2026-10-28",
        monat: 10,
        storno: false,
        merkmale: "StKl I, Kfb 0,5, ev",
        brutto: 6000_00,
        steuerBrutto: 6000_00,
        steuerfrei: 0,
        pauschalBrutto: 0,
        lohnsteuer: 1200_00,
        soli: 0,
        kirchensteuer: 100_00,
        pauschsteuer: 0,
        svArbeitnehmer: 0,
        svArbeitgeber: 0,
        netto: 4700_00,
      },
    ],
  );
  const doc = { lohnkonto: konto, arbeitgeber: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen" }, heute: "2026-11-05" };

  it("Zeilen und Summe formatiert, Aufbewahrung nach § 41 Abs. 1 Satz 9 EStG", () => {
    const data = lohnkontoPdfData(doc);
    expect(data.zeilen[0]?.slice(0, 5)).toEqual(["28.10.2026", "10/2026", "Abrechnung", "StKl I, Kfb 0,5, ev", "6.000,00"]);
    expect(data.summe.at(-1)).toBe("4.700,00");
    expect(data.hinweise.at(-1)).toMatch(/^Aufbewahren bis 31\.12\.2032/);
  });

  it("erzeugt ein PDF/A-3b", () => {
    expect(Buffer.from(buildLohnkontoPdf(doc)).toString("latin1").slice(0, 5)).toBe("%PDF-");
  });
});
