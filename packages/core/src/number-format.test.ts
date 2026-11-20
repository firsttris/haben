import { describe, expect, it } from "vitest";
import { purposeContainsNumber } from "./matching.ts";
import {
  circleKey,
  counterCircle,
  customerNumberProblem,
  documentNumberLengthProblem,
  effectiveCustomerNumber,
  issueDateBeforeLastFinalized,
  DEFAULT_CUSTOMER_NUMBER_FORMAT,
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
  formatDocumentNumber,
  numberFormatError,
  usesCustomerNumber,
  voucherField,
} from "./number-format.ts";

describe("formatDocumentNumber", () => {
  it("bleibt ab Werk bei 2026-034 und AN-2026-007", () => {
    expect(formatDocumentNumber(DEFAULT_INVOICE_NUMBER_FORMAT, "2026-01-15", 34)).toBe("2026-034");
    expect(formatDocumentNumber(DEFAULT_QUOTE_NUMBER_FORMAT, "2026-01-15", 7)).toBe("AN-2026-007");
  });

  it("setzt Präfix, zweistelliges Jahr und Stellenzahl ein", () => {
    expect(formatDocumentNumber("RE-{JJJJ}-{NNNN}", "2026-01-15", 34)).toBe("RE-2026-0034");
    expect(formatDocumentNumber("R{JJ}{NNN}", "2026-01-15", 5)).toBe("R26005");
    expect(formatDocumentNumber("{JJ}.{N}", "2009-01-15", 12)).toBe("09.12");
  });

  it("setzt den Monat des Belegdatums zweistellig ein (#328)", () => {
    expect(formatDocumentNumber("RE-{JJJJ}-{MM}-{NNNN}", "2026-10-31", 34)).toBe("RE-2026-10-0034");
    expect(formatDocumentNumber("RE-{JJJJ}-{MM}-{NNNN}", "2026-11-01", 35)).toBe("RE-2026-11-0035");
    expect(formatDocumentNumber("{JJ}{MM}{NNN}", "2027-01-02", 1)).toBe("2701001");
  });

  it("schneidet nie ab, wenn die laufende Nummer mehr Stellen hat", () => {
    expect(formatDocumentNumber("{JJJJ}-{NN}", "2026-01-15", 1234)).toBe("2026-1234");
  });
});

describe("Bankabgleich mit eigenem Format", () => {
  it("findet die Nummer im Verwendungszweck, auch klein und ohne Trennzeichen", () => {
    const number = formatDocumentNumber("RE-{JJJJ}-{NNNN}", "2026-01-15", 34);
    expect(purposeContainsNumber("Zahlung re 2026 0034 danke", number)).toBe(true);
    expect(purposeContainsNumber("RE2026003", number)).toBe(false);
    expect(purposeContainsNumber("Rechnung R26034", formatDocumentNumber("R{JJ}{NNN}", "2026-01-15", 34))).toBe(true);
  });
});

describe("numberFormatError", () => {
  it("lässt die Vorgaben und übliche Muster durch", () => {
    for (const format of [DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT, "RE-{JJJJ}-{NNNN}", "R{JJ}{NNN}", "{JJJJ}_{N}.A"]) {
      expect(numberFormatError(format), format).toBeNull();
    }
  });

  it("verlangt genau eine laufende Nummer", () => {
    expect(numberFormatError("RE-{JJJJ}")).toMatch(/laufende Nummer/);
    expect(numberFormatError("{JJJJ}-{NNN}-{NN}")).toMatch(/genau einmal/);
  });

  it("verlangt das Jahr, weil der Zähler jedes Jahr neu beginnt", () => {
    expect(numberFormatError("RE-{NNN}")).toMatch(/Jahr/);
    // Der Monat allein reicht nicht: Im nächsten Jahr gäbe es wieder RE-10-001
    expect(numberFormatError("RE-{MM}-{NNN}")).toMatch(/Jahr/);
  });

  it("verlangt kein Jahr, wenn der Zähler durchläuft, erlaubt Jahr und Monat aber (#328)", () => {
    expect(numberFormatError("RE-{NNNN}", { requireYear: false })).toBeNull();
    expect(numberFormatError("RE-{JJJJ}-{MM}-{NNNN}", { requireYear: false })).toBeNull();
  });

  it("lehnt unbekannte Platzhalter, Zeichen für Dateinamen und Überlänge ab", () => {
    expect(numberFormatError("{JJJJ}-{M}-{NNN}")).toMatch(/\{M\}/);
    expect(numberFormatError("{JJJJ}-{NNNNNNN}")).toMatch(/\{NNNNNNN\}/);
    expect(numberFormatError("RE/{JJJJ}/{NNN}")).toMatch(/Buchstaben, Ziffern/);
    expect(numberFormatError("RE {JJJJ}-{NNN}")).toMatch(/Buchstaben, Ziffern/);
    expect(numberFormatError("{JJJJ-{NNN}")).toMatch(/Buchstaben, Ziffern/);
    expect(numberFormatError(`${"X".repeat(30)}{JJJJ}{NNN}`)).toMatch(/30 Zeichen/);
  });

  it("verlangt bei Kundennummern kein Jahr, weil deren Zähler nicht jährlich neu beginnt", () => {
    expect(numberFormatError("K-{NNNN}", { requireYear: false })).toBeNull();
    expect(numberFormatError(DEFAULT_CUSTOMER_NUMBER_FORMAT, { requireYear: false })).toBeNull();
    expect(formatDocumentNumber(DEFAULT_CUSTOMER_NUMBER_FORMAT, "2026-01-15", 7)).toBe("K-0007");
    expect(numberFormatError("K-", { requireYear: false })).toMatch(/laufende Nummer/);
    expect(numberFormatError("K {NNNN}", { requireYear: false })).toMatch(/Buchstaben, Ziffern/);
  });
});

describe("Platzhalter {KUNDENNR} (#1426)", () => {
  const allowCustomer = { requireYear: false, allowCustomer: true } as const;

  it("setzt die Kundennummer des Käufers ein, auch eine reine Ziffernnummer", () => {
    expect(formatDocumentNumber("RE-{KUNDENNR}-{NNN}", "2026-01-15", 1, "ACME")).toBe("RE-ACME-001");
    expect(formatDocumentNumber("RE-{KUNDENNR}-{NNN}", "2026-01-15", 7, "10042")).toBe("RE-10042-007");
    expect(formatDocumentNumber("AN-{JJJJ}-{KUNDENNR}-{NN}", "2026-01-15", 34, "K-0001")).toBe("AN-2026-K-0001-34");
  });

  it("lässt {KUNDENNR} ohne Kundennummer als Text stehen (Vorschau ohne Kunden)", () => {
    expect(formatDocumentNumber("RE-{KUNDENNR}-{NNN}", "2026-01-15", 1)).toBe("RE-{KUNDENNR}-001");
  });

  it("erlaubt {KUNDENNR} nur mit allowCustomer", () => {
    expect(numberFormatError("RE-{KUNDENNR}-{NNN}", allowCustomer)).toBeNull();
    expect(numberFormatError("RE-{KUNDENNR}-{NNN}", { requireYear: false })).toMatch(/gibt es nicht/);
    expect(numberFormatError("K-{KUNDENNR}-{NNN}", { requireYear: false })).toBe(
      "Den Platzhalter {KUNDENNR} gibt es nicht. Möglich sind {JJJJ}, {JJ}, {MM} und {N} bis {NNNNNN}.",
    );
    // Bei Rechnungen und Angeboten nennt die Meldung den Platzhalter als Möglichkeit
    expect(numberFormatError("RE-{FIRMA}-{NNN}", allowCustomer)).toContain("{KUNDENNR}");
  });

  it("verlangt {KUNDENNR} höchstens einmal und nie direkt neben der laufenden Nummer", () => {
    expect(numberFormatError("{KUNDENNR}-{KUNDENNR}-{NNN}", allowCustomer)).toMatch(/nur einmal/);
    // "1004" + 2001 und "10042" + 1 ergäben beides 10042001
    expect(numberFormatError("{KUNDENNR}{NNN}", allowCustomer)).toMatch(/direkt neben der laufenden Nummer/);
    expect(numberFormatError("{NNN}{KUNDENNR}", allowCustomer)).toMatch(/direkt neben der laufenden Nummer/);
    expect(numberFormatError("RE-{KUNDENNR}-{NNN}", allowCustomer)).toBeNull();
    // Neben Jahr und Monat ist sie erlaubt: die haben feste Breite
    expect(numberFormatError("{JJJJ}{KUNDENNR}-{NNN}", allowCustomer)).toBeNull();
  });

  it("verlangt beim Zähler je Kunde die Kundennummer im Format (requireCustomer, #1426)", () => {
    const perCustomer = { requireYear: false, allowCustomer: true, requireCustomer: true } as const;
    expect(numberFormatError("RE-{JJJJ}-{NNN}", perCustomer)).toMatch(/\{KUNDENNR\}.*eigenen Nummernkreis/);
    expect(numberFormatError("RE-{NNN}", perCustomer)).toMatch(/\{KUNDENNR\}/);
    expect(numberFormatError("RE-{JJJJ}-{KUNDENNR}-{NNN}", perCustomer)).toBeNull();
    expect(numberFormatError("RE-{KUNDENNR}-{NNN}", perCustomer)).toBeNull();
    // requireCustomer schließt den Platzhalter auch ohne allowCustomer ein
    expect(numberFormatError("RE-{KUNDENNR}-{NNN}", { requireYear: false, requireCustomer: true })).toBeNull();
    expect(numberFormatError("RE-{NNN}", { requireYear: false, requireCustomer: true })).toMatch(/\{KUNDENNR\}/);
  });
});

describe("documentNumberLengthProblem (#1426)", () => {
  it("lässt Nummern bis 36 Zeichen zu und meldet längere", () => {
    expect(documentNumberLengthProblem("RE-2026-ACME-001")).toBeNull();
    expect(documentNumberLengthProblem("X".repeat(36))).toBeNull();
    expect(documentNumberLengthProblem("X".repeat(37))).toMatch(/36 Zeichen.*DATEV/);
  });
});

describe("usesCustomerNumber und customerNumberProblem (#1426)", () => {
  it("erkennt {KUNDENNR} im Format", () => {
    expect(usesCustomerNumber("RE-{KUNDENNR}-{NNN}")).toBe(true);
    expect(usesCustomerNumber("RE-{JJJJ}-{NNN}")).toBe(false);
  });

  it("meldet fehlende und ungeeignete Kundennummern", () => {
    expect(customerNumberProblem(undefined)).toMatch(/braucht eine Kundennummer.*\{KUNDENNR\}/);
    expect(customerNumberProblem(null)).toMatch(/braucht eine Kundennummer/);
    expect(customerNumberProblem("")).toMatch(/braucht eine Kundennummer/);
    expect(customerNumberProblem("   ")).toMatch(/braucht eine Kundennummer/);
    expect(customerNumberProblem("A/B")).toMatch(/Buchstaben, Ziffern/);
    expect(customerNumberProblem("Müller")).toMatch(/Buchstaben, Ziffern/);
    expect(customerNumberProblem("ACME")).toBeNull();
    expect(customerNumberProblem("K-0001.A_B")).toBeNull();
  });
});

describe("effectiveCustomerNumber (#1426)", () => {
  it("nimmt die Kundennummer des Originals, solange sie taugt", () => {
    expect(effectiveCustomerNumber({ kundennummer: "ACME" }, { kundennummer: "NEUE-9" })).toBe("ACME");
    expect(effectiveCustomerNumber(null, { kundennummer: "ACME" })).toBe("ACME");
  });

  it("fällt auf die heutige des Kontakts zurück, wenn die des Originals fehlt oder ungültig ist", () => {
    expect(effectiveCustomerNumber({}, { kundennummer: "ACME" })).toBe("ACME");
    expect(effectiveCustomerNumber({ kundennummer: "10/2024" }, { kundennummer: "ACME" })).toBe("ACME");
    // Taugt auch die des Kontakts nicht, bleibt sie die zu meldende Nummer
    expect(effectiveCustomerNumber({ kundennummer: "10/2024" }, { kundennummer: "K 1" })).toBe("K 1");
    expect(effectiveCustomerNumber({ kundennummer: "10/2024" }, {})).toBeUndefined();
    expect(effectiveCustomerNumber(null, null)).toBeUndefined();
  });
});

describe("counterCircle", () => {
  it("zählt je Jahr des Belegdatums oder in einem durchlaufenden Kreis (#328)", () => {
    expect(counterCircle(false, "2026-12-31")).toBe(2026);
    expect(counterCircle(false, "2027-01-01")).toBe(2027);
    expect(counterCircle(true, "2026-12-31")).toBe(0);
    expect(counterCircle(true, "2027-01-01")).toBe(0);
  });
});

describe("issueDateBeforeLastFinalized", () => {
  const byCircle = {
    2026: { number: "RE-2026-0004", issueDate: "2026-11-09" },
    2027: { number: "RE-2027-0001", issueDate: "2027-01-10" },
  };

  it("meldet nur, wenn das Datum vor der letzten festgeschriebenen Rechnung desselben Kreises liegt (#713)", () => {
    expect(issueDateBeforeLastFinalized({}, false, "2026-10-01")).toBeNull();
    expect(issueDateBeforeLastFinalized(byCircle, false, "2026-11-09")).toBeNull();
    expect(issueDateBeforeLastFinalized(byCircle, false, "2026-11-10")).toBeNull();
    expect(issueDateBeforeLastFinalized(byCircle, false, "2026-10-01")).toEqual(byCircle[2026]);
    expect(issueDateBeforeLastFinalized(byCircle, false, "2025-12-15")).toBeNull();
    expect(issueDateBeforeLastFinalized(byCircle, false, "2027-01-05")).toEqual(byCircle[2027]);
  });

  it("folgt beim durchlaufenden Zähler dem Kreis 0 und vor dessen erster Rechnung dem jüngsten Jahr", () => {
    expect(issueDateBeforeLastFinalized(byCircle, true, "2027-01-05")).toEqual(byCircle[2027]);
    expect(issueDateBeforeLastFinalized(byCircle, true, "2027-01-10")).toBeNull();
    const withRunning = { ...byCircle, 0: { number: "RE-0006", issueDate: "2027-02-01" } };
    expect(issueDateBeforeLastFinalized(withRunning, true, "2027-01-15")).toEqual(withRunning[0]);
    expect(issueDateBeforeLastFinalized(withRunning, true, "2027-02-01")).toBeNull();
  });

  it("trennt die Kreise je Kontakt; der gemeinsame Kreis bleibt ohne Kontakt (#1426)", () => {
    const kreise = {
      "2026": { number: "RE-2026-004", issueDate: "2026-11-09" },
      "2026:k1": { number: "RE-2026-A-001", issueDate: "2026-11-20" },
      "2026:k2": { number: "RE-2026-B-001", issueDate: "2026-10-05" },
    };
    // Kunde k1: nur die eigene letzte Rechnung zählt, die anderer Kreise stört nicht
    expect(issueDateBeforeLastFinalized(kreise, false, "2026-11-19", "k1")).toEqual(kreise["2026:k1"]);
    expect(issueDateBeforeLastFinalized(kreise, false, "2026-11-19", "k2")).toBeNull();
    expect(issueDateBeforeLastFinalized(kreise, false, "2026-10-04", "k2")).toEqual(kreise["2026:k2"]);
    // der gemeinsame Kreis sieht nur die eigenen Belege
    expect(issueDateBeforeLastFinalized(kreise, false, "2026-11-08")).toEqual(kreise["2026"]);
    expect(issueDateBeforeLastFinalized(kreise, false, "2026-11-19")).toBeNull();
  });

  it("folgt beim durchlaufenden Kundenkreis dem Kreis 0 des Kontakts und vorher dessen jüngstem Jahr", () => {
    const kreise = {
      "2025:k1": { number: "RE-2025-A-009", issueDate: "2025-12-20" },
      "2026:k1": { number: "RE-2026-A-001", issueDate: "2026-03-01" },
      "2026": { number: "RE-2026-004", issueDate: "2026-11-09" },
    };
    // Kreis 0 des Kontakts fehlt: das jüngste Jahr desselben Kontakts gilt, nicht das des gemeinsamen Kreises
    expect(issueDateBeforeLastFinalized(kreise, true, "2026-01-15", "k1")).toEqual(kreise["2026:k1"]);
    expect(issueDateBeforeLastFinalized(kreise, true, "2026-10-01", "k1")).toBeNull();
    // steht der Kreis 0 des Kontakts, gilt nur er
    const mitNull = { ...kreise, "0:k1": { number: "RE-A-010", issueDate: "2026-05-02" } };
    expect(issueDateBeforeLastFinalized(mitNull, true, "2026-04-15", "k1")).toEqual(mitNull["0:k1"]);
  });
});

describe("circleKey", () => {
  it("schlüsselt den gemeinsamen Kreis wie bisher über das Jahr, den Kundenkreis über Jahr:Kontakt", () => {
    expect(circleKey(2026, null)).toBe("2026");
    expect(circleKey(0, null)).toBe("0");
    expect(circleKey(2026, "b5f7d4b2-8a4c-4c1e-9d2e-1f3a5b6c7d8e")).toBe("2026:b5f7d4b2-8a4c-4c1e-9d2e-1f3a5b6c7d8e");
  });
});

describe("voucherField", () => {
  it("lässt die erlaubten Zeichen stehen und macht den Punkt zum Bindestrich", () => {
    expect(voucherField("RE-2026-034")).toBe("RE-2026-034");
    expect(voucherField("RE.2026.001")).toBe("RE-2026-001");
    expect(voucherField("A$&%*+-/9")).toBe("A$&%*+-/9");
  });

  it("streicht den Rest: Unterstrich, Leerzeichen, Umlaute, Komma und Doppelpunkt", () => {
    expect(voucherField("RE-2026-A1_1")).toBe("RE-2026-A11");
    expect(voucherField("Re_Ü 12,5: B")).toBe("Re125B");
  });

  it("kürzt auf die 36 Zeichen des Belegfelds 1", () => {
    expect(voucherField("R".repeat(40))).toHaveLength(36);
  });

  it("bildet verschiedene Nummern auf dasselbe Belegfeld ab (#1426)", () => {
    expect(voucherField("RE-2026-A1_1")).toBe(voucherField("RE-2026-A_11"));
    expect(voucherField("RE-2026-A.1_1")).toBe(voucherField("RE-2026-A-1_1"));
  });
});
