import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sevFileExpectation, sevFileFinding } from "./dateistand.ts";

// Antworten aus Buchhaltung 1.0, nur Metadaten (test-fixtures/sevdesk/README.md)
const fixture = JSON.parse(readFileSync(new URL("../../test-fixtures/sevdesk/buchhaltung-1.0/dateistand.json", import.meta.url), "utf8"));
const vorlage = JSON.parse(readFileSync(new URL("../../test-fixtures/sevdesk/buchhaltung-1.0/beleg-aus-vorlage.json", import.meta.url), "utf8"));

describe("sevFileExpectation", () => {
  it("erwartet beim Beleg mit document genau diese Datei, die GET /Document/{id} auflöst", () => {
    const { voucher, dokument } = fixture.belegMitDatei;
    expect(sevFileExpectation("voucher", voucher)).toEqual({ kind: "verweis", documentId: dokument.id });
  });

  it("erwartet beim Beleg ohne document keine Datei, aus einer Vorlage deren Datei", () => {
    expect(sevFileExpectation("voucher", fixture.belegOhneDatei.voucher)).toEqual({ kind: "keine", templateId: null });
    const ausVorlage = vorlage.beleg;
    expect(sevFileExpectation("voucher", ausVorlage)).toEqual({ kind: "keine", templateId: vorlage.vorlage.id });
  });

  it("verlangt bei Rechnung und Gutschrift das PDF, auch wenn sie kein document tragen", () => {
    // Die fertige Rechnung hat in GET /Document einen Eintrag mit baseObject, der Entwurf nicht
    expect(fixture.rechnungMitDokument.dokument.baseObject).toEqual({ id: fixture.rechnungMitDokument.invoice.id, objectName: "Invoice" });
    expect(sevFileExpectation("invoice", fixture.rechnungMitDokument.invoice)).toEqual({ kind: "pdf" });
    expect(sevFileExpectation("creditnote", {})).toEqual({ kind: "pdf" });
  });
});

describe("sevFileFinding", () => {
  it("meldet einen Beleg ohne document als ohne Datei, nicht als Fehler", () => {
    expect(sevFileFinding({ kind: "keine", templateId: null }, { main: false })).toMatchObject({ state: "ohne_datei", role: null });
    expect(sevFileFinding({ kind: "keine", templateId: "ID_1" }, { main: true })).toBeNull();
  });

  it("meldet eine genannte, aber nicht gelieferte Datei als fehlgeschlagenen Abruf mit Quell-ID", () => {
    expect(sevFileFinding({ kind: "verweis", documentId: "ID_5" }, { main: false })).toEqual({
      state: "abruf_fehlgeschlagen",
      role: "anhang",
      sourceFileId: "ID_5",
      message: "Datei ID_5 fehlt: sevDesk gab die Datei nicht heraus",
    });
  });

  it("stuft eine Rechnung ohne PDF nie als ohne Datei ein", () => {
    expect(sevFileFinding({ kind: "pdf" }, { main: false, mainError: "404" })).toMatchObject({
      state: "abruf_fehlgeschlagen",
      role: "pdf",
      message: "PDF fehlt: 404",
    });
  });

  it("meldet ein fehlendes XML neben vorhandenem PDF als fehlenden Anhang", () => {
    expect(sevFileFinding({ kind: "pdf" }, { main: true, xmlError: "Status 500" })).toMatchObject({ state: "anhang_fehlt", role: "xml" });
    expect(sevFileFinding({ kind: "pdf" }, { main: true })).toBeNull();
  });
});
