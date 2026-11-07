import { describe, expect, it } from "vitest";
import { detectOwnInvoice, ownInvoiceHint, type OwnCompany, type OwnInvoiceRule, type TextLine } from "./index.ts";
import { ustIdsIn } from "./identifiers.ts";
import { roleBefore } from "./terms.ts";

const company: OwnCompany = {
  name: "Musterdesign GmbH",
  ustId: "DE123456789",
  steuernummern: ["21/815/08150", "2181508150"],
  iban: "DE89 3704 0044 0532 0130 00",
  plz: "70173",
};

/** Zeile auf Seite 1; `top` als Anteil der Seitenhöhe */
const line = (text: string, top: number, left = 0.1): TextLine => ({ page: 1, text, top, left });

/** Eigene Ausgangsrechnung im üblichen deutschen Layout: Absenderzeile, Anschriftfeld des Kunden, Fußzeile */
const ownLayout: TextLine[] = [
  line("Musterdesign GmbH · Königstraße 1 · 70173 Stuttgart", 0.16),
  line("Kunde AG", 0.19),
  line("Hauptstraße 5", 0.21),
  line("10115 Berlin", 0.23),
  line("Rechnung RE-2026-042", 0.35, 0.1),
  line("Gesamtbetrag 1.190,00 €", 0.6),
  line("Musterdesign GmbH · Geschäftsführer Max Muster · Amtsgericht Stuttgart HRB 12345", 0.9),
  line("USt-IdNr. DE 123 456 789 · St.-Nr. 21/815/08150", 0.92),
  line("Bankverbindung: IBAN DE89 3704 0044 0532 0130 00", 0.94),
];

/** Eingangsrechnung mit Reverse Charge: Die eigene USt-IdNr. steht als Angabe des Empfängers im Rumpf */
const supplierLayout: TextLine[] = [
  line("Cloud Services Ireland Ltd · 1 Dock Road · Dublin", 0.16),
  line("Musterdesign GmbH", 0.19),
  line("Königstraße 1", 0.21),
  line("70173 Stuttgart", 0.23),
  line("Ihre USt-IdNr.: DE123456789", 0.4, 0.55),
  line("Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)", 0.65),
  line("Cloud Services Ireland Ltd · VAT ID IE 6388047V · Registered office Dublin", 0.92),
];

describe("eigene Rechnung erkennen", () => {
  it("erkennt eine E-Rechnung an der eigenen USt-IdNr. des Verkäufers sicher", () => {
    const verdict = detectOwnInvoice({ parties: { source: "xml", seller: { name: "Musterdesign GmbH", ustId: "DE123456789" } } }, company);
    expect(verdict.level).toBe("sicher");
    expect(verdict.signals.map((s) => s.rule)).toContain("rechnungssteller-ust-id");
  });

  it("erkennt eine E-Rechnung allein an der eigenen Steuernummer", () => {
    const verdict = detectOwnInvoice({ parties: { source: "xml", seller: { name: "Irgendwer", steuernummer: "2181508150" } } }, company);
    expect(verdict.level).toBe("sicher");
  });

  it("hält eine E-Rechnung eines Lieferanten an uns nicht für eigene, auch wenn unsere USt-IdNr. beim Käufer steht", () => {
    const verdict = detectOwnInvoice(
      { parties: { source: "xml", seller: { name: "Lieferant GmbH", ustId: "DE811907980" }, buyer: { name: "Musterdesign GmbH", ustId: "DE123456789" } } },
      company,
    );
    expect(verdict.level).toBe("keine");
    expect(verdict.confidence).toBe(0);
  });

  it("erkennt ein PDF im üblichen Layout an Fußzeile, Steuernummer und IBAN sicher", () => {
    const verdict = detectOwnInvoice({ lines: ownLayout }, company);
    expect(verdict.level).toBe("sicher");
    expect(verdict.signals.filter((s) => s.direction === "own").map((s) => s.rule)).toEqual(
      expect.arrayContaining(["ust-id-im-text", "steuernummer-im-text", "iban-im-text", "name-im-text"]),
    );
  });

  it("hält eine Reverse-Charge-Rechnung mit unserer USt-IdNr. beim Empfänger nicht für eigene", () => {
    const verdict = detectOwnInvoice({ lines: supplierLayout }, company);
    expect(verdict.level).toBe("keine");
    expect(verdict.signals.filter((s) => s.direction === "foreign").map((s) => s.rule)).toEqual(
      expect.arrayContaining(["ust-id-im-text", "andere-ust-id", "name-im-text"]),
    );
  });

  it("eine reine Beschriftung in der Zeile darüber zählt, auch im Informationsblock", () => {
    const lines = [line("Ihre USt-IdNr.", 0.2, 0.6), line("DE 123 456 789", 0.22, 0.6)];
    expect(detectOwnInvoice({ lines }, company).signals).toEqual([
      expect.objectContaining({ rule: "ust-id-im-text", direction: "foreign", confidence: 0.85 }),
      expect.objectContaining({ rule: "andere-ust-id", direction: "own" }),
    ]);
    expect(detectOwnInvoice({ lines }, company).level).toBe("keine");
  });

  it("die eigene Steuernummer allein reicht für „sicher“", () => {
    expect(detectOwnInvoice({ lines: [line("Steuernummer 21/815/08150", 0.5)] }, company).level).toBe("sicher");
  });

  it("die eigene USt-IdNr. allein in der Fußzeile ergibt „vermutlich“", () => {
    expect(detectOwnInvoice({ lines: [line("DE123456789", 0.9)] }, company).level).toBe("vermutlich");
  });

  it("die eigene IBAN bei einer Lastschrift spricht gegen eine eigene Rechnung", () => {
    const lines = [line("Der Betrag wird per SEPA-Lastschrift von Ihrem Konto", 0.6), line("DE89 3704 0044 0532 0130 00 abgebucht.", 0.62)];
    const verdict = detectOwnInvoice({ lines }, company);
    expect(verdict.level).toBe("keine");
    expect(verdict.signals).toEqual([expect.objectContaining({ rule: "iban-im-text", direction: "foreign" })]);
  });

  it("die eigene IBAN in der Bankverbindung spricht für eine eigene Rechnung", () => {
    const verdict = detectOwnInvoice({ lines: [line("Bankverbindung IBAN DE89370400440532013000", 0.5)] }, company);
    expect(verdict.signals).toEqual([expect.objectContaining({ rule: "iban-im-text", direction: "own", confidence: 0.85 })]);
  });

  it("die KI nennt die eigene Firma als Rechnungssteller", () => {
    const verdict = detectOwnInvoice({ parties: { source: "ki", seller: { name: "Musterdesign", ustId: "DE 123 456 789" } } }, company);
    expect(verdict.level).toBe("sicher");
  });

  it("eine Ausgangsrechnung in Haben mit gleicher Nummer und gleichem Betrag", () => {
    expect(detectOwnInvoice({ knownInvoiceNumber: "RE-2026-042" }, company).level).toBe("sicher");
  });

  it("ohne eigene Angaben in den Firmendaten erkennt nichts", () => {
    const empty: OwnCompany = { name: "", ustId: "", steuernummern: [], iban: "", plz: "" };
    expect(detectOwnInvoice({ lines: ownLayout, parties: { source: "xml", seller: { name: "", ustId: "" } } }, empty).level).toBe("keine");
  });

  it("nimmt weitere Regeln an und zählt je Regel nur das stärkste Signal", () => {
    const twice: OwnInvoiceRule = () => [
      { rule: "test", direction: "own", confidence: 0.5, reason: "a" },
      { rule: "test", direction: "own", confidence: 0.5, reason: "b" },
    ];
    const verdict = detectOwnInvoice({}, company, [twice]);
    expect(verdict.confidence).toBe(0.5);
    expect(verdict.signals).toHaveLength(1);
  });

  it("verknüpft unabhängige Regeln und mindert um Gegenhinweise", () => {
    const rules: OwnInvoiceRule[] = [
      () => [{ rule: "a", direction: "own", confidence: 0.5, reason: "" }],
      () => [{ rule: "b", direction: "own", confidence: 0.5, reason: "" }],
      () => [{ rule: "c", direction: "foreign", confidence: 0.2, reason: "" }],
    ];
    expect(detectOwnInvoice({}, company, rules).confidence).toBeCloseTo(0.75 * 0.8);
  });

  it("Hinweis mit den Gründen für die eigene Rechnung", () => {
    const hint = ownInvoiceHint(detectOwnInvoice({ parties: { source: "xml", seller: { name: "Musterdesign GmbH", ustId: "DE123456789" } } }, company));
    expect(hint).toMatch(/^Das ist eine eigene Ausgangsrechnung, keine Ausgabe\. Die USt-IdNr\. des Rechnungsstellers in der E-Rechnung ist deine eigene\./);
    expect(ownInvoiceHint(detectOwnInvoice({}, company))).toBeNull();
  });
});

describe("Zuordnung aus dem Text davor", () => {
  it.each([
    ["Ihre USt-IdNr.:", "buyer"],
    ["Kunden-USt-IdNr.", "buyer"],
    ["USt-IdNr. des Leistungsempfängers", "buyer"],
    ["Customer VAT ID", "buyer"],
    ["Bill to · VAT", "buyer"],
    ["Unsere USt-IdNr.", "seller"],
    ["Amtsgericht Stuttgart HRB 12345 · USt-IdNr.", "seller"],
    ["Our VAT number", "seller"],
    ["Ihre USt-IdNr. DE111111111 · Unsere USt-IdNr.", "seller"],
    ["USt-IdNr.", null],
  ] as const)("„%s“ → %s", (text, role) => {
    expect(roleBefore(text)).toBe(role);
  });
});

describe("USt-IdNrn. im Text", () => {
  it("findet Nummern mit Leerzeichen, ohne angrenzende Wörter oder IBANs", () => {
    expect(ustIdsIn("USt-IdNr. DE 123 456 789 HRB 1234")).toEqual(["DE123456789"]);
    expect(ustIdsIn("IBAN DE89 3704 0044 0532 0130 00")).toEqual([]);
    expect(ustIdsIn("VAT NL123456789B01, ATU12345678, IE6388047V")).toEqual(["NL123456789B01", "ATU12345678", "IE6388047V"]);
  });
});
