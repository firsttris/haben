import { describe, expect, it } from "vitest";
import { buildUstidBestaetigungPdf, type UstidBestaetigungDocument, ustidBestaetigungPdfData } from "./ustid-bestaetigung.ts";

/*
 * Antwort des BZSt als PDF (#1491): alle Angaben der gespeicherten Antwort, der Satz, dass es keine Bestätigung des BZSt
 * ist, und der Datensatz unverändert. Werte wie die Testabfrage vom 2026-11-18 (OpenAPI-Beispielwerte).
 */

const antwort =
  '{"id":"7c1f0e2a9b3d4e55","anfrageZeitpunkt":"2026-11-18T14:34:38.12045+01:00","status":"evatr-0000","ergFirmenname":"A","ergStrasse":"A","ergPlz":"D","ergOrt":"B"}';

const qualifiziert: UstidBestaetigungDocument = {
  kontakt: "Donaublick GmbH",
  art: "qualifiziert",
  anfragendeUstid: "DE136695976",
  angefragteUstid: "ATU12345678",
  firmenname: "Donaublick GmbH",
  strasse: "Praterstraße 3",
  plz: null,
  ort: "Wien",
  status: "evatr-0000",
  anfrageZeitpunkt: new Date("2026-11-18T14:34:38.120+01:00"),
  gueltigAb: null,
  gueltigBis: null,
  ergFirmenname: "A",
  ergStrasse: "A",
  ergPlz: "C",
  ergOrt: "B",
  bzstId: "7c1f0e2a9b3d4e55",
  antwort,
  heute: "2026-11-20",
  firma: "Mustermann IT",
};

describe("Antwort des BZSt als PDF", () => {
  it("nennt Nummern, Zeitpunkt mit Uhrzeit in deutscher Zeit, ID, Status mit Code und Text und das Ergebnis je Angabe", () => {
    const data = ustidBestaetigungPdfData(qualifiziert);
    expect(data.title).toBe("Antwort des BZSt zur USt-IdNr. ATU12345678");
    expect(data.docTitle).toBe("Antwort des BZSt zur USt-IdNr. ATU12345678 vom 18.11.2026");
    // Der Tag im Titel der PDF-Metadaten ist der Tag in Deutschland
    expect(ustidBestaetigungPdfData({ ...qualifiziert, anfrageZeitpunkt: new Date("2026-11-18T23:30:00Z") }).docTitle).toMatch(/ vom 19\.11\.2026$/);
    expect(data.untertitel).toContain("qualifizierte Abfrage mit Name und Anschrift");
    expect(data.anfrage).toEqual([
      { label: "Angefragte USt-IdNr.", value: "ATU12345678" },
      { label: "Eigene USt-IdNr.", value: "DE136695976" },
      { label: "Kontakt in Haben", value: "Donaublick GmbH" },
      { label: "Zeitpunkt der Anfrage", value: "18.11.2026, 14:34:38 Uhr" },
      { label: "ID der Antwort", value: "7c1f0e2a9b3d4e55" },
    ]);
    expect(data.ergebnis).toEqual([{ label: "Status", value: "Gültig (evatr-0000)" }]);
    expect(data.angaben).toEqual([
      { label: "Name", gesendet: "Donaublick GmbH", ergebnis: "Stimmt" },
      { label: "Straße", gesendet: "Praterstraße 3", ergebnis: "Stimmt" },
      { label: "PLZ", gesendet: "nicht gesendet", ergebnis: "Nicht angefragt" },
      { label: "Ort", gesendet: "Wien", ergebnis: "Stimmt nicht" },
    ]);
  });

  it("sagt, dass es keine Bestätigung des BZSt ist, und gibt den Datensatz unverändert wieder", () => {
    const data = ustidBestaetigungPdfData(qualifiziert);
    expect(data.hinweis).toMatch(/gespeichert hat; es ist keine Bestätigung des BZSt/);
    expect(data.datensatz.join("")).toBe(antwort);
    expect(Math.max(...data.datensatz.map((zeile) => zeile.length))).toBeLessThanOrEqual(80);
  });

  it("einfach ohne Angaben; bei nicht mehr gültiger Nummer mit dem Zeitraum der Gültigkeit", () => {
    const data = ustidBestaetigungPdfData({
      ...qualifiziert,
      art: "einfach",
      firmenname: null,
      strasse: null,
      ort: null,
      status: "evatr-2006",
      gueltigAb: "2019-03-01",
      gueltigBis: "2026-03-10",
      ergFirmenname: null,
      ergStrasse: null,
      ergPlz: null,
      ergOrt: null,
      bzstId: null,
    });
    expect(data.untertitel).toContain("einfache Abfrage");
    expect(data.angaben).toBeNull();
    expect(data.ergebnis).toEqual([
      { label: "Status", value: "Nicht mehr gültig; gültig war sie vom 2019-03-01 bis 2026-03-10 (evatr-2006)" },
      { label: "Gültig ab", value: "01.03.2019" },
      { label: "Gültig bis", value: "10.03.2026" },
    ]);
    expect(data.anfrage.at(-1)).toEqual({ label: "ID der Antwort", value: "–" });
  });

  it("erzeugt ein PDF, qualifiziert und einfach", () => {
    for (const doc of [qualifiziert, { ...qualifiziert, art: "einfach" as const }]) {
      const pdf = buildUstidBestaetigungPdf(doc);
      expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    }
  });
});
