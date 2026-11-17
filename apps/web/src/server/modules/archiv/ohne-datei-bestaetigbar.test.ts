import { describe, expect, it } from "vitest";
import { ohneDateiBestaetigbar } from "./ohne-datei.ts";

/*
 * Wer einen Beleg ohne Datei bestätigen darf: sevDesk nach dem Abruf, Accountable, wenn der Stapel keine
 * Beleg-GUID nennt. Rechnungen und Gutschriften bleiben außen vor, sie brauchen ihr Original-PDF.
 */
describe("ohneDateiBestaetigbar", () => {
  it("lässt Belege aus sevDesk zu", () => {
    expect(ohneDateiBestaetigbar({ source: "sevdesk", lexofficeId: "voucher/ID_103", type: "purchaseinvoice" })).toBe(true);
  });

  it("lehnt Rechnungen und Gutschriften aus sevDesk ab", () => {
    expect(ohneDateiBestaetigbar({ source: "sevdesk", lexofficeId: "invoice/ID_301", type: "salesinvoice" })).toBe(false);
    expect(ohneDateiBestaetigbar({ source: "sevdesk", lexofficeId: "creditnote/ID_302", type: "creditnote" })).toBe(false);
  });

  it("lässt Belege aus dem Accountable-Stapel zu", () => {
    expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/167", type: "purchaseinvoice" })).toBe(true);
  });

  it("verlangt bei Accountable den Typ Einkaufsbeleg", () => {
    expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/169", type: "purchaseinvoice" })).toBe(true);
    expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/169", type: "unbekannt" })).toBe(false);
  });

  it("lässt eine Buchung mit Beleg-GUID nicht bestätigen, auch wenn die Datei im Export fehlt", () => {
    expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/903", type: "purchaseinvoice", guid: "a1b2c3" })).toBe(false);
    expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/903", type: "purchaseinvoice", guid: null })).toBe(true);
  });

  it("lässt eine Buchung nicht bestätigen, zu der Accountable ein Dokument führt (Spalte Y „Dokument Vorhanden“)", () => {
    // Sammelrechnung: Y steht an jeder Zeile der Rechnung, die Datei hängt nur an einer; ein Einzelbeleg existiert also
    const zeile = { source: "accountable", lexofficeId: "accountable/row/904", type: "purchaseinvoice", guid: null };
    expect(ohneDateiBestaetigbar({ ...zeile, documentPresent: true })).toBe(false);
    expect(ohneDateiBestaetigbar({ ...zeile, documentPresent: false })).toBe(true);
    // Ohne Daten.xlsx sagt die Quelle nichts: es bleibt bei der Beleg-GUID
    expect(ohneDateiBestaetigbar({ ...zeile, documentPresent: null })).toBe(true);
  });

  it("lehnt Ausgangsrechnungen aus dem Accountable-Stapel ab", () => {
    expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/200", type: "salesinvoice" })).toBe(false);
  });

  it("lehnt fremde Quellen ab", () => {
    expect(ohneDateiBestaetigbar({ source: "lexoffice", lexofficeId: "voucher/ID_1", type: "purchaseinvoice" })).toBe(false);
  });
});
