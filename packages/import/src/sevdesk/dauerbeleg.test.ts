import { describe, expect, it } from "vitest";
import vorlagen from "../../test-fixtures/sevdesk/buchhaltung-1.0/beleg-wiederkehrend-rv.json";
import { mapSevRecurringVoucher, sevIntervalMonths } from "./dauerbeleg.ts";
import type { SevVoucher, SevVoucherPos } from "./types.ts";

/* #472: Vorlagen wiederkehrender Belege (RV) aus sevDesk als Dauerbelege, angehalten bis zur Prüfung. */

const [ohneTermin, mitTermin, mitEnde] = vorlagen as unknown as { voucher: SevVoucher; positions: SevVoucherPos[] }[];
const HEUTE = "2024-06-01";

describe("sevIntervalMonths", () => {
  it.each([
    ["P0Y1M", 1],
    ["P0Y3M", 3],
    ["P0Y6M", 6],
    ["P1Y", 12],
    ["P1Y0M", 12],
    ["P0Y0M1W", null],
    ["P14D", null],
    ["", null],
    [null, null],
  ])("%s → %s", (iso, months) => {
    expect(sevIntervalMonths(iso)).toBe(months);
  });
});

describe("mapSevRecurringVoucher", () => {
  it("übernimmt Status 100 mit nächstem Termin angehalten, Betrag aus dem Kopf, ohne Datei mit Hinweis", () => {
    const r = mapSevRecurringVoucher(mitTermin!.voucher, mitTermin!.positions, HEUTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dauerbeleg).toMatchObject({
      sevdeskId: "ID_37",
      status: "pausiert",
      intervalMonths: 1,
      nextDate: "2024-01-15",
      anchorDay: 15,
      startDate: "2024-01-15",
      endDate: null,
      category: "sonstiges",
      payment: "bank",
      amounts: [{ taxRate: 0, net: 10000, tax: 0 }],
      taxShown: false,
      documentId: null,
    });
    expect(r.hinweise).toEqual([
      "Kategorie und Bezahlung kennt sevDesk nicht: „Sonstiger Aufwand“ und Geschäftskonto gesetzt.",
      "Steuerart „custom“ in sevDesk; Steuersatz und Vorsteuer prüfen.",
      "In sevDesk ohne Datei: Vor dem Fortsetzen den Vertrag oder die Dauerrechnung hochladen.",
    ]);
  });

  it("nimmt bei Status 50 ohne nächsten Termin den Start und nennt das", () => {
    const r = mapSevRecurringVoucher(ohneTermin!.voucher, ohneTermin!.positions, HEUTE);
    expect(r.ok && r.dauerbeleg).toMatchObject({ status: "pausiert", nextDate: "2024-01-15" });
    expect(r.ok && r.hinweise[0]).toBe("In sevDesk kein nächster Termin (Status 50); der nächste Beleg steht auf dem Start 15.01.2024.");
  });

  it("lässt Status 1000 mit abgelaufenem Ende beendet, mit künftigem Ende angehalten", () => {
    const vorbei = mapSevRecurringVoucher(mitEnde!.voucher, mitEnde!.positions, HEUTE);
    expect(vorbei.ok && vorbei.dauerbeleg).toMatchObject({ status: "beendet", intervalMonths: 3, endDate: "2024-01-15" });
    const kuenftig = mapSevRecurringVoucher(mitEnde!.voucher, mitEnde!.positions, "2024-01-15");
    expect(kuenftig.ok && kuenftig.dauerbeleg.status).toBe("pausiert");
    expect(kuenftig.ok && kuenftig.hinweise).toContain("In sevDesk endet die Vorlage am 15.01.2024.");
  });

  it("übernimmt Lieferant, USt-IdNr., Nummer, Datei und Zahlungsziel", () => {
    const v = {
      ...mitTermin!.voucher,
      supplierName: "",
      supplierNameAtSave: "Hausverwaltung Beispiel",
      supplier: { id: "ID_9", objectName: "Contact" },
      vatNumber: "de 123",
      description: "MIETE-1",
      document: { id: "ID_5", objectName: "Document" },
      voucherDate: "2024-01-15T00:00:00+01:00",
      paymentDeadline: "2024-01-29T00:00:00+01:00",
      sumTax: "19",
      sumGross: "119",
      taxType: "custom",
    };
    const r = mapSevRecurringVoucher(v, [{ id: "1", taxRate: "19", sumNet: "100", sumTax: "19", sumGross: "119" }], HEUTE);
    expect(r.ok && r.dauerbeleg).toMatchObject({
      name: "Hausverwaltung Beispiel",
      supplierName: "Hausverwaltung Beispiel",
      supplierUstId: "DE123",
      supplierSevdeskId: "ID_9",
      reference: "MIETE-1",
      documentId: "ID_5",
      dueDays: 14,
      amounts: [{ taxRate: 1900, net: 10000, tax: 1900 }],
      taxShown: true,
    });
    expect(r.ok && r.hinweise).toContain("Steuerart „custom“ in sevDesk; Steuersatz und Vorsteuer prüfen.");
  });

  it.each([
    [{ creditDebit: "D" }, "Einnahme: Dauerbelege in Haben sind Ausgaben."],
    [{ recurringInterval: "P0Y0M1W", recurringIntervall: 0 }, "Intervall P0Y0M1W (0): Haben kennt 1, 3, 6 und 12 Monate."],
    [{ recurringInterval: "P0Y2M", recurringIntervall: 2 }, "Intervall P0Y2M (2): Haben kennt 1, 3, 6 und 12 Monate."],
    [{ currency: "USD" }, "Währung USD: Dauerbelege in Haben sind in Euro."],
    [{ sumGross: "-100", sumNet: "-100" }, "Negative Summe: Dauerbelege sind Ausgaben, keine Gutschriften."],
    [{ recurringNextVoucher: null, recurringStartDate: null }, "Weder nächster Termin noch Start angegeben."],
    [{ voucherType: "VOU" }, "Keine Vorlage wiederkehrender Belege."],
  ])("übernimmt nicht und nennt den Grund: %o", (change, grund) => {
    expect(mapSevRecurringVoucher({ ...mitTermin!.voucher, ...change }, [], HEUTE)).toEqual({ ok: false, grund });
  });

  it("nimmt bei widersprüchlichem Intervall die ISO-Dauer und nennt das", () => {
    const r = mapSevRecurringVoucher(mitEnde!.voucher, mitEnde!.positions, HEUTE);
    expect(r.ok && r.hinweise).toContain("Intervall in sevDesk widersprüchlich (P0Y3M, 1); 3 Monate übernommen.");
  });

  it("übernimmt keinen Steuersatz, den Dauerbelege nicht kennen", () => {
    const v = { ...mitTermin!.voucher, sumTax: "16", sumGross: "116" };
    const r = mapSevRecurringVoucher(v, [{ id: "1", taxRate: "16", sumNet: "100", sumTax: "16", sumGross: "116" }], HEUTE);
    expect(r).toEqual({ ok: false, grund: "Steuersatz 16 %: Dauerbelege kennen 19, 7 und 0 %." });
  });

  it("behält den Monatsletzten als Ankertag, wenn der nächste Termin in einen kürzeren Monat fällt (Review #1130)", () => {
    const v = { ...mitTermin!.voucher, recurringStartDate: "2027-01-31T00:00:00+01:00", recurringNextVoucher: "2027-02-28T00:00:00+01:00" };
    const r = mapSevRecurringVoucher(v, mitTermin!.positions, HEUTE);
    expect(r.ok && r.dauerbeleg).toMatchObject({ nextDate: "2027-02-28", anchorDay: 31 });
  });

  it("nimmt bei verschobenem Termin den Tag des nächsten Termins als Ankertag (Review #1130)", () => {
    const v = { ...mitTermin!.voucher, recurringStartDate: "2027-01-15T00:00:00+01:00", recurringNextVoucher: "2027-03-01T00:00:00+01:00" };
    const r = mapSevRecurringVoucher(v, mitTermin!.positions, HEUTE);
    expect(r.ok && r.dauerbeleg).toMatchObject({ nextDate: "2027-03-01", anchorDay: 1 });
  });

  it("übernimmt keine Steuer ohne erkennbaren Satz (Review #1130)", () => {
    const v = { ...mitTermin!.voucher, sumNet: "100", sumTax: "20", sumGross: "120" };
    const r = mapSevRecurringVoucher(v, [], HEUTE);
    expect(r.ok).toBe(false);
  });
});
