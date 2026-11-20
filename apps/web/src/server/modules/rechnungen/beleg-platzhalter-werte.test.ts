import type { InvoiceDocument, QuoteDocument } from "@haben/einvoice";
import { describe, expect, it } from "vitest";
import { BELEG_PLATZHALTER } from "@haben/core";
import { angebotMitPlatzhaltern, rechnungMitPlatzhaltern, rechnungsWerte } from "./beleg-platzhalter.ts";

// Werte der Platzhalter in Einleitung und Hinweis (#1334), unabhängig von der Datenbank
const rechnung = (extra: Partial<InvoiceDocument> = {}) =>
  ({
    kind: "rechnung",
    number: "RE-2026-0042",
    issueDate: "2026-11-02",
    dueDate: "2026-11-16",
    currency: "EUR",
    language: "de",
    serviceFrom: "2026-10-01",
    serviceTo: "2026-10-31",
    seller: { name: "Mustermann Wartung", iban: "de89370400440532013000", bic: "COBADEFFXXX" },
    buyer: { name: "Hausverwaltung Musterhof GmbH" },
    totals: { net: 10_000, tax: 1_900, gross: 11_900 },
    ...extra,
  }) as InvoiceDocument;

describe("Platzhalter in Einleitung und Hinweis (#1334)", () => {
  it("hat für jeden angebotenen Platzhalter einen Wert", () => {
    expect(Object.keys(rechnungsWerte(rechnung())).sort()).toEqual(Object.keys(BELEG_PLATZHALTER).sort());
  });

  it("setzt Werte in Einleitung und Hinweis ein, IBAN in Vierergruppen; Unbekanntes und das übrige Blatt bleiben", () => {
    const doc = rechnungMitPlatzhaltern(rechnung({ intro: "{art} {nummer} vom {datum} für {kunde}", note: "IBAN {iban}, BIC {bic}, {gibtsnicht}" }));
    expect(doc.intro).toBe("Rechnung RE-2026-0042 vom 02.11.2026 für Hausverwaltung Musterhof GmbH");
    expect(doc.note).toBe("IBAN DE89 3704 0044 0532 0130 00, BIC COBADEFFXXX, {gibtsnicht}");
    expect(doc.number).toBe("RE-2026-0042");
  });

  it("nennt den Leistungszeitraum, ein einzelnes Leistungsdatum oder nichts", () => {
    expect(rechnungsWerte(rechnung()).leistungszeitraum).toBe("01.10.2026 – 31.10.2026");
    expect(rechnungsWerte(rechnung({ serviceTo: undefined })).leistungszeitraum).toBe("01.10.2026");
    expect(rechnungsWerte(rechnung({ serviceFrom: "2026-10-31" })).leistungszeitraum).toBe("31.10.2026");
    expect(rechnungsWerte(rechnung({ serviceFrom: undefined, serviceTo: undefined })).leistungszeitraum).toBe("");
  });

  it("formatiert nach Sprache und Währung der Rechnung; Schlussrechnung heißt so", () => {
    const en = rechnungsWerte(rechnung({ language: "en", currency: "USD", variant: "schluss" }));
    expect(en.art).toBe("Final invoice");
    expect(en.datum).toBe(rechnungsWerte(rechnung({ language: "en" })).datum);
    expect(en.betrag).toContain("USD");
    expect(rechnungsWerte(rechnung({ variant: "schluss" })).art).toBe("Schlussrechnung");
  });

  it("lässt IBAN und BIC ohne Bankkonto leer; ein Entwurf ohne Nummer zeigt ENTWURF", () => {
    const werte = rechnungsWerte(rechnung({ number: "", seller: { name: "Mustermann Wartung" } as InvoiceDocument["seller"] }));
    expect({ iban: werte.iban, bic: werte.bic, nummer: werte.nummer }).toEqual({ iban: "", bic: "", nummer: "ENTWURF" });
  });

  it("kennt beim Angebot {gueltig}, aber keine Fälligkeit", () => {
    const angebot = {
      ...rechnung({ intro: "{art} {nummer}, gültig bis {gueltig}{faellig}" }),
      validUntil: "2026-11-30",
    } as unknown as QuoteDocument;
    expect(angebotMitPlatzhaltern(angebot).intro).toBe("Angebot RE-2026-0042, gültig bis 30.11.2026");
  });
});
