import { leistungsdatum } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ADVANCE_DOCS,
  FINALIZE_DIALOG_TEXT,
  FINALIZE_HINT,
  FORMAT_HINT,
  ForeignCurrencyHint,
  FOREIGN_CURRENCY_DOCS,
  SERVICE_HINT_TEXT,
  ServiceHint,
  serviceHintIds,
  serviceHintState,
} from "./InvoiceEditorHinweise.tsx";

describe("Hinweise im Rechnungseditor (#1253)", () => {
  it("Leistungszeitraum: der Hinweis sagt, dass leer das Rechnungsdatum gilt, und das gilt tatsächlich", () => {
    const html = renderToStaticMarkup(createElement(ServiceHint, { state: "normal" }));
    expect(html).toContain(`id="${serviceHintIds("rechnung").von}"`);
    expect(html).toContain("Beide leer: Auf der Rechnung steht das Rechnungsdatum.");
    expect(html).toContain(`href="${ADVANCE_DOCS}"`);
    expect(leistungsdatum({ belegdatum: "2026-11-19" })).toBe("2026-11-19");
    // Im Angebot gibt es kein Rechnungsdatum, und ohne Angabe steht keine Zeile im PDF
    expect(renderToStaticMarkup(createElement(ServiceHint, { state: "angebot" }))).not.toContain("Rechnungsdatum");
  });

  it("Fremdwährung: drei Sätze mit allen Folgen, Währung und Kurs und ein Link in die Doku", () => {
    const html = renderToStaticMarkup(createElement(ForeignCurrencyHint, { currencyCode: "USD", rateInfo: "Kurs 1,0812 (09/2026)" }));
    expect(html).toContain('id="invoice-currency-hint"');
    expect(html).toContain("<strong>Kurs 1,0812 (09/2026). </strong>");
    expect(html).toContain("Preise und Summen stehen in USD");
    for (const folge of [
      "§ 14 Abs. 4 Nr. 8 UStG",
      "gebucht wird in Euro",
      "Umsatzsteuer-Umrechnungskurs des Leistungsmonats",
      "BMF",
      "Kein GiroCode",
      "Schlussrechnung",
      "Mahnung",
    ]) {
      expect(html).toContain(folge);
    }
    expect(html).toContain(`href="${FOREIGN_CURRENCY_DOCS}"`);
    expect(renderToStaticMarkup(createElement(ForeignCurrencyHint, { currencyCode: "", rateInfo: null }))).toContain("in der Fremdwährung");
  });

  it("Format und Festschreiben: Entscheidungshilfe und Folge am Knopf", () => {
    expect(FORMAT_HINT).toMatch(/^ZUGFeRD passt für die meisten Kunden\. XRechnung nur, wenn der Kunde sie verlangt.*Leitweg-ID/);
    expect(FINALIZE_HINT).toBe("Danach nicht mehr änderbar, Haben vergibt die Nummer");
  });
});

/**
 * Jeder Zustand des Editors, in dem „Leistung von“ und „Leistung bis“ stehen, und ob jedes der beiden Felder leer bleiben darf. Gegen den
 * Server gelesen: Nur eine Abschlagsrechnung mit erbrachter Teilleistung verlangt „Leistung von“ (`finalizeIssues` in `invoices.ts`, „Leistungsdatum
 * der erbrachten Teilleistung fehlt“), „Leistung bis“ ist nie Pflicht. Die Schlussrechnung nimmt ohne Angabe ihr Rechnungsdatum (`leistungsdatum`),
 * ebenso Storno und Korrektur, die das Leistungsdatum des Originals übernehmen (`invoices.ts`, `stornoOf` und Korrektur); das Angebot speichert
 * `null` (`quotes.ts`) und zeigt dann keine Zeile. Nur an einer normalen Rechnung (kein Abschlag, EUR, regulär) löst ein eingetragener Tag das
 * Vorauszahlungsverfahren aus (`advanceProcedure`): Der Hinweis verweist dort auf die Vorauszahlungen, ohne die Steuerfolge zu nennen.
 */
const EUR = { currency: "EUR", taxTreatment: "regulaer" };
const ZUSTAENDE = [
  { name: "Rechnung (EUR, regulär)", editor: { kind: "rechnung", variant: null, advanceType: "anzahlung", ...EUR }, zustand: "normal", vonLeerErlaubt: true },
  {
    name: "Rechnung in USD",
    editor: { kind: "rechnung", variant: null, advanceType: "anzahlung", currency: "USD", taxTreatment: "regulaer" },
    zustand: "rechnung",
    vonLeerErlaubt: true,
  },
  {
    name: "Rechnung mit Reverse Charge",
    editor: { kind: "rechnung", variant: null, advanceType: "anzahlung", currency: "EUR", taxTreatment: "reverse_charge" },
    zustand: "rechnung",
    vonLeerErlaubt: true,
  },
  { name: "Storno", editor: { kind: "storno", variant: null, advanceType: "anzahlung", ...EUR }, zustand: "rechnung", vonLeerErlaubt: true },
  { name: "Korrektur", editor: { kind: "korrektur", variant: null, advanceType: "anzahlung", ...EUR }, zustand: "rechnung", vonLeerErlaubt: true },
  {
    name: "Abschlag als Anzahlung",
    editor: { kind: "rechnung", variant: "abschlag", advanceType: "anzahlung", ...EUR },
    zustand: "rechnung",
    vonLeerErlaubt: true,
  },
  {
    name: "Abschlag mit erbrachter Teilleistung",
    editor: { kind: "rechnung", variant: "abschlag", advanceType: "teilleistung", ...EUR },
    zustand: "teilleistung",
    vonLeerErlaubt: false,
  },
  { name: "Schlussrechnung", editor: { kind: "rechnung", variant: "schluss", advanceType: "anzahlung", ...EUR }, zustand: "rechnung", vonLeerErlaubt: true },
  { name: "Angebot", editor: { kind: "angebot", variant: null, advanceType: "anzahlung", ...EUR }, zustand: "angebot", vonLeerErlaubt: true },
] as const;

describe("Hinweis zu „Leistung von“ und „Leistung bis“ in jedem Zustand des Editors (#1253)", () => {
  it.each(ZUSTAENDE)("$name", ({ editor, zustand, vonLeerErlaubt }) => {
    const state = serviceHintState(editor);
    expect(state).toBe(zustand);
    const { von, bis } = SERVICE_HINT_TEXT[state];
    // „Leistung von“: „Leer: …“ genau dann, wenn leer bleiben darf, sonst Pflicht
    expect(/[Ll]eer:/.test(von)).toBe(vonLeerErlaubt);
    expect(von.includes("Pflicht")).toBe(!vonLeerErlaubt);
    // „Leistung bis“ ist nie Pflicht, und was für leer gilt, steht dort wie bei „von“
    expect(bis).not.toContain("Pflicht");
    if (vonLeerErlaubt) expect(bis).toBe(von);
    // „Rechnungsdatum“ gibt es nur auf der Rechnung, nicht im Angebot und nicht im Hinweis zum Ende der Teilleistung
    const aufRechnung = zustand === "rechnung" || zustand === "normal";
    expect(von.includes("Rechnungsdatum")).toBe(aufRechnung);
    expect(bis.includes("Rechnungsdatum")).toBe(aufRechnung);
    // Die Vorauszahlung steht nur dort, wo ein eingetragener Tag das Vorauszahlungsverfahren auslöst, und der Hinweis sagt nicht, leer und eingetragen seien gleich
    expect(von.includes("Vorauszahlung")).toBe(zustand === "normal");
    expect(bis.includes("Vorauszahlung")).toBe(zustand === "normal");
    // Die Steuerfolge der Vorauszahlung steht nur in der Doku, nicht im Hinweis
    expect(`${von} ${bis}`).not.toMatch(/Zahlungsmonat|Soll|Ist-|entsteht/);
    // Ein eigener Hinweis je Feld nur, wenn die Texte sich unterscheiden
    const ids = serviceHintIds(state);
    expect(ids.von === ids.bis).toBe(von === bis);
  });
});

/**
 * Was das Festschreiben tut, je Rechtsform und Art der Rechnung. `gebucht` ist gegen `advanceInvoicePosting` (`advance-invoice.ts`) gelesen:
 * Eine Anzahlungsanforderung bucht bei GmbH und UG nichts (Anspruch noch nicht bilanziert, #750), sonst bucht das Festschreiben. Nummer, PDF
 * und XML entstehen in jedem Fall. Der Satz der Rückfrage darf deshalb nur sagen, was in allen Zeilen gilt.
 */
const FESTSCHREIBEN = [
  { name: "Rechnung, Einzelunternehmen", gebucht: true },
  { name: "Rechnung, GmbH", gebucht: true },
  { name: "Rechnung, UG", gebucht: true },
  { name: "Abschlag als Anzahlung, Einzelunternehmen", gebucht: true },
  { name: "Abschlag als Anzahlung, GmbH", gebucht: false },
  { name: "Abschlag als Anzahlung, UG", gebucht: false },
  { name: "Abschlag mit erbrachter Teilleistung, GmbH", gebucht: true },
  { name: "Schlussrechnung, GmbH", gebucht: true },
] as const;

describe("Rückfrage beim Festschreiben einer Rechnung (#1253)", () => {
  it.each(FESTSCHREIBEN)("$name", () => {
    // Der Satz behauptet keine Buchung; mit „gebucht“ stimmte er in den Zeilen mit gebucht: false nicht
    expect(FINALIZE_DIALOG_TEXT).not.toMatch(/buch/i);
    expect(FINALIZE_DIALOG_TEXT).toContain("Nummer");
    expect(FINALIZE_DIALOG_TEXT).toContain("PDF und XML");
  });
  it("Die Tabelle enthält Zeilen mit und ohne Buchung, sonst prüfte der Satz nichts", () => {
    expect(new Set(FESTSCHREIBEN.map((z) => z.gebucht))).toEqual(new Set([true, false]));
  });
});

describe("Ein Feld leer, das andere gefüllt (#1253)", () => {
  it("Der Server rechnet bis ?? von ?? Rechnungsdatum; der Hinweis an jedem Feld sagt deshalb „beide leer“", () => {
    const belegdatum = "2026-11-19";
    expect(leistungsdatum({ belegdatum, leistungVon: "2026-11-01", leistungBis: null })).not.toBe(belegdatum);
    expect(leistungsdatum({ belegdatum, leistungVon: null, leistungBis: "2026-11-30" })).not.toBe(belegdatum);
    for (const state of ["normal", "rechnung"] as const) {
      expect(SERVICE_HINT_TEXT[state].bis).toMatch(/Beide leer: /);
      expect(SERVICE_HINT_TEXT[state].von).toMatch(/Beide leer: /);
    }
  });
});
