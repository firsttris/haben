import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoice.ts";
import { ACCOUNT_NAMES, ACCOUNTS, documentPosting, invoicePaymentPosting, invoicePosting, invoiceWriteOffPosting } from "./posting.ts";
import { treatmentIssues, treatmentNote } from "./treatment.ts";
import { computeUstva } from "./ustva.ts";

/*
 * Innergemeinschaftlicher Erwerb (§ 1a UStG), innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG) und
 * Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG): Buchung, Prüfung und Kennzahlen der Voranmeldung
 */

const balanced = (lines: { debit: number; credit: number }[]) => lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

/** Beleg ohne Umsatzsteuer des Lieferanten: Haben rechnet die Erwerbsteuer aus dem Netto, gezahlt wird netto */
function erwerb(net: number, rate: 1900 | 700) {
  const base = computeInvoiceTotals([{ quantity: 1000, unitPrice: net, taxRate: rate }]);
  return { ...base, gross: base.net };
}

describe("Innergemeinschaftlicher Erwerb am Eingangsbeleg", () => {
  it("Beispiel aus der Anfrage: 500 € Hardware aus den Niederlanden, 95 € Erwerbsteuer und 95 € Erwerbsvorsteuer (SKR03)", () => {
    const lines = documentPosting(erwerb(50_000, 1900), "wareneinkauf", "SKR03", "einzelunternehmen", "bank", true, undefined, 0, "ig_erwerb");
    expect(lines).toEqual([
      { account: "3200", debit: 50_000, credit: 0, taxCode: "IGE19" },
      { account: "1574", debit: 9_500, credit: 0, taxCode: "VStIGE" },
      { account: "1774", debit: 0, credit: 9_500, taxCode: "IGE19" },
      { account: "1600", debit: 0, credit: 50_000, taxCode: null },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("SKR04 und 7 %: eigene Konten für Erwerbsteuer und Erwerbsvorsteuer", () => {
    expect(documentPosting(erwerb(50_000, 1900), "buero", "SKR04", "einzelunternehmen", "bank", true, undefined, 0, "ig_erwerb")).toEqual([
      { account: "6815", debit: 50_000, credit: 0, taxCode: "IGE19" },
      { account: "1404", debit: 9_500, credit: 0, taxCode: "VStIGE" },
      { account: "3804", debit: 0, credit: 9_500, taxCode: "IGE19" },
      { account: "3300", debit: 0, credit: 50_000, taxCode: null },
    ]);
    expect(
      documentPosting(erwerb(10_000, 700), "literatur", "SKR03", "einzelunternehmen", "privat", true, undefined, 0, "ig_erwerb").map((l) => [
        l.account,
        l.debit - l.credit,
        l.taxCode,
      ]),
    ).toEqual([
      ["4940", 10_000, "IGE7"],
      ["1572", 700, "VStIGE"],
      ["1772", -700, "IGE7"],
      ["1890", -10_000, null],
    ]);
    expect(
      documentPosting(erwerb(10_000, 700), "literatur", "SKR04", "einzelunternehmen", "bank", true, undefined, 0, "ig_erwerb").map((l) => l.account),
    ).toEqual(["6820", "1402", "3802", "3300"]);
  });

  it("Anlagegut: Netto auf das Anlagekonto, Erwerbsteuer und Erwerbsvorsteuer daneben", () => {
    const lines = documentPosting(erwerb(200_000, 1900), "anlage", "SKR03", "einzelunternehmen", "bank", true, "0650", 0, "ig_erwerb");
    expect(lines.map((l) => [l.account, l.debit - l.credit])).toEqual([
      ["0650", 200_000],
      ["1574", 38_000],
      ["1774", -38_000],
      ["1600", -200_000],
    ]);
  });

  it("Gutschrift (Storno) dreht die Seiten, Privatanteil kürzt nur die Vorsteuer", () => {
    const credit = { ...erwerb(-50_000, 1900) };
    const lines = documentPosting(credit, "wareneinkauf", "SKR03", "einzelunternehmen", "bank", true, undefined, 0, "ig_erwerb");
    expect(lines.find((l) => l.account === "1774")).toMatchObject({ debit: 9_500, credit: 0 });
    expect(lines.find((l) => l.account === "1574")).toMatchObject({ debit: 0, credit: 9_500 });
    const shared = documentPosting(erwerb(50_000, 1900), "telefon", "SKR03", "einzelunternehmen", "bank", true, undefined, 20, "ig_erwerb");
    expect(shared.find((l) => l.account === "1574")!.debit).toBe(7_600);
    expect(shared.find((l) => l.account === "1774")!.credit).toBe(9_500);
    expect(balanced(shared)).toBe(true);
  });

  it("ohne Steuersatz geht es nicht: steuerfreie Erwerbe (Kz 91) unterstützt Haben nicht", () => {
    const zero = { ...computeInvoiceTotals([{ quantity: 1000, unitPrice: 100, taxRate: 0 }]) };
    expect(() => documentPosting(zero, "buero", "SKR03", "einzelunternehmen", "bank", true, undefined, 0, "ig_erwerb")).toThrow(RangeError);
  });

  it("§ 13b und gewöhnliche Einkäufe bleiben auf ihren Konten", () => {
    const rc = documentPosting(erwerb(50_000, 1900), "software", "SKR03", "einzelunternehmen", "bank", true, undefined, 0, "eu");
    expect(rc.map((l) => l.account)).toEqual(["4964", "1577", "1787", "1600"]);
    const normal = documentPosting(
      computeInvoiceTotals([{ quantity: 1000, unitPrice: 50_000, taxRate: 1900 }]),
      "wareneinkauf",
      "SKR03",
      "einzelunternehmen",
      "bank",
    );
    expect(normal.map((l) => [l.account, l.taxCode])).toEqual([
      ["3200", "VSt19"],
      ["1576", "VSt19"],
      ["1600", null],
    ]);
  });

  it("die Konten tragen die Namen aus dem DATEV-Kontenrahmen", () => {
    expect(ACCOUNT_NAMES.SKR03[ACCOUNTS.SKR03.ustIge[1900]]).toBe("Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %");
    expect(ACCOUNT_NAMES.SKR04[ACCOUNTS.SKR04.vorsteuerIge[1900]]).toBe("Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %");
    expect(ACCOUNT_NAMES.SKR03[ACCOUNTS.SKR03.erloeseSonder.ig_lieferung]).toBe("Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG");
    expect(ACCOUNT_NAMES.SKR04[ACCOUNTS.SKR04.erloeseSonder.ausfuhr]).toBe("Steuerfreie Umsätze § 4 Nr. 1a UStG");
  });
});

describe("Innergemeinschaftliche Lieferung und Ausfuhr auf der Ausgangsrechnung", () => {
  const zero = computeInvoiceTotals([{ quantity: 1000, unitPrice: 300_000, taxRate: 0 }]);

  it("steuerfreie Erlöse auf eigene Konten, Ist wie Soll ohne Umsatzsteuer", () => {
    expect(invoicePosting(zero, "SKR03", "ist", "ig_lieferung")).toEqual([
      { account: "1400", debit: 300_000, credit: 0, taxCode: null },
      { account: "8125", debit: 0, credit: 300_000, taxCode: "IGL" },
    ]);
    expect(invoicePosting(zero, "SKR04", "soll", "ig_lieferung")[1]).toMatchObject({ account: "4125", taxCode: "IGL" });
    expect(invoicePosting(zero, "SKR03", "soll", "ausfuhr")[1]).toMatchObject({ account: "8120", taxCode: "Ausfuhr" });
    expect(invoicePosting(zero, "SKR04", "ist", "ausfuhr")[1]).toMatchObject({ account: "4120", taxCode: "Ausfuhr" });
    // Zahlung: nichts umzubuchen, auch bei Ist
    expect(invoicePaymentPosting(zero, 300_000, "SKR03", "ist").map((l) => l.account)).toEqual(["1200", "1400"]);
    // Skonto mindert die Bemessungsgrundlage mit dem Steuerschlüssel der Lieferung
    expect(invoiceWriteOffPosting("skonto", zero, 6_000, "SKR03", "soll", "ig_lieferung").map((l) => [l.account, l.taxCode])).toEqual([
      ["1400", null],
      ["8730", "IGL"],
    ]);
  });

  it("lehnt Steuersätze über 0 % ab", () => {
    const taxed = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100, taxRate: 1900 }]);
    expect(() => invoicePosting(taxed, "SKR03", "soll", "ig_lieferung")).toThrow(RangeError);
    expect(() => invoicePosting(taxed, "SKR03", "soll", "ausfuhr")).toThrow(RangeError);
  });

  it("innergemeinschaftliche Lieferung: beide USt-IdNrn. (§ 14a Abs. 3 UStG) und ein Kunde im übrigen Gemeinschaftsgebiet", () => {
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "NL123456789B01", buyerCountry: "NL" })).toEqual([]);
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "EL123456789", buyerCountry: "GR" })).toEqual([]);
    expect(treatmentIssues("ig_lieferung", { rates: [0], buyerCountry: "NL" })).toEqual([
      "Innergemeinschaftliche Lieferung braucht deine USt-IdNr. in den Firmendaten (§ 14a Abs. 3 UStG)",
      "Innergemeinschaftliche Lieferung braucht die USt-IdNr. des Kunden (§ 6a Abs. 1 Nr. 4 UStG)",
    ]);
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "DE987654321", buyerCountry: "DE" })).toEqual([
      "DE987654321: eine deutsche USt-IdNr. gehört nicht in die Zusammenfassende Meldung",
      "Innergemeinschaftliche Lieferung nur an Kunden in einem anderen EU-Mitgliedstaat",
    ]);
    expect(treatmentIssues("ig_lieferung", { rates: [0], sellerUstId: "DE123456789", buyerUstId: "CHE123456789", buyerCountry: "CH" })).toHaveLength(2);
  });

  it("Ausfuhr: Kunde im Drittland und deine USt-IdNr. (EN 16931 BR-G-02)", () => {
    expect(treatmentIssues("ausfuhr", { rates: [0], sellerUstId: "DE123456789", buyerCountry: "CH" })).toEqual([]);
    expect(treatmentIssues("ausfuhr", { rates: [0], buyerCountry: "AT" })).toEqual([
      "Ausfuhrlieferung braucht deine USt-IdNr. in den Firmendaten (EN 16931 BR-G-02)",
      "Ausfuhrlieferung nur an Kunden außerhalb der EU; im Gemeinschaftsgebiet ist es eine innergemeinschaftliche Lieferung",
    ]);
    expect(treatmentIssues("ausfuhr", { rates: [0], sellerUstId: "DE123456789", buyerCountry: "DE" })).toHaveLength(1);
  });

  it("Pflichthinweis auf der Rechnung nach § 14a Abs. 3 bzw. § 6 UStG", () => {
    expect(treatmentNote("ig_lieferung")).toBe("Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG).");
    expect(treatmentNote("ausfuhr")).toBe("Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG).");
  });
});

describe("Kennzahlen der Voranmeldung", () => {
  it("Kz 89 und 93: Erwerbsteuer aus der Bemessungsgrundlage, Kz 61 zieht sie als Vorsteuer wieder ab", () => {
    const result = computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz89: 50_000, kz93: 10_099, kz61: 9_500 + 700 });
    expect(result).toMatchObject({ kz89: 50_000, tax89: 9_500, kz93: 10_000, tax93: 700, kz61: 10_200, kz83: 0 });
  });

  it("Kz 41 und 43: steuerfrei mit Vorsteuerabzug, in vollen Euro, ohne Steuer", () => {
    const result = computeUstva({ kz81: 100_000, kz86: 0, kz66: 0, kz41: 300_050, kz43: 120_099 });
    expect(result).toMatchObject({ kz41: 300_000, kz43: 120_000, kz83: 19_000 });
  });
});
