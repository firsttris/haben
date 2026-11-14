import { describe, expect, it } from "vitest";
import { previewWisoExport, WisoParseError } from "./index.ts";

const HEADER =
  "Buchungsnummer;Teilbuchung;Zahlungsdatum;Wertstellungsdatum;Buchungstext;Konto;Kontobezeichnung;Gegenkonto;Gegenkontobezeichnung;Soll;Haben;Steuerschluessel;Steuersatz;Steuerschluesselbezeichnung;Belegnummer;Buchungsdatum;UStID;Umsatzart";

function csvBytes(lines: string[]): Uint8Array {
  return new TextEncoder().encode([HEADER, ...lines].join("\r\n"));
}

describe("previewWisoExport", () => {
  it("liest WISO Steuer (Modul EÜR) mit anonymisiertem Buchungsdatum und Teilbuchungen", () => {
    const bytes = csvBytes([
      "1;1;01.01.2026;01.01.2026;Saldovortrag;1200;Bank;9000;Saldenvorträge, Sachkonten;34027,99;0,00;;0,00;;;**.**.**26;;0",
      "6;1;01.01.2026;01.01.2026;Werbung;4600;Werbekosten;1200;Bank;67,92;0,00;VSt 19 %;19,00;Vorsteuer 19 %;n4;**.**.**26;;0",
      "10;1;05.01.2026;05.01.2026;Honorar;8400;Erlöse 19 % USt;1200;Bank;0,00;200,00;USt 19 %;19,00;Umsatzsteuer 19 %;R8;**.**.**26;;0",
      "37;1;17.02.2026;17.02.2026;Sammelrechnung Teil 1;8400;Erlöse 19 % USt;1200;Bank;0,00;119,00;USt 19 %;19,00;Umsatzsteuer 19 %;R5;**.**.**26;;0",
      "37;2;17.02.2026;17.02.2026;Sammelrechnung Teil 2;8200;Umsatzsteuerpflichtige Erlöse;1200;Bank;0,00;7,69;USt 0 %;0,00;Umsatzsteuer 0 %;R5;**.**.**26;;0",
    ]);

    const preview = previewWisoExport(bytes, "SKR03");
    expect(preview.years).toEqual([2026]);
    expect(preview.bookings).toBe(4);
    expect(preview.rows).toBe(5);
    expect(preview.dateFrom).toBe("2026-01-01");
    expect(preview.dateTo).toBe("2026-02-17");

    const saldo = preview.vouchers[0]!;
    expect(saldo.neutral).toBe(true);
    expect(saldo.voucher.gross).toBe(3402799);
    expect(saldo.voucher.tax).toBe(0);

    const werbung = preview.vouchers[1]!;
    expect(werbung.neutral).toBe(false);
    expect(werbung.voucher.direction).toBe("ausgabe");
    expect(werbung.voucher.type).toBe("purchaseinvoice");
    expect(werbung.voucher.gross).toBe(6792);
    expect(werbung.voucher.tax).toBe(1084);
    expect(werbung.voucher.net).toBe(5708);
    expect(werbung.raw.ohneBeleg).toBe(true);

    const honorar = preview.vouchers[2]!;
    expect(honorar.voucher.direction).toBe("einnahme");
    expect(honorar.voucher.type).toBe("salesinvoice");
    expect(honorar.voucher.gross).toBe(20000);
    expect(honorar.voucher.tax).toBe(3193);
    expect(honorar.voucher.net).toBe(16807);

    const sammel = preview.vouchers[3]!;
    expect(sammel.voucher.categories).toHaveLength(2);
    expect(sammel.voucher.gross).toBe(12669);
    expect(sammel.voucher.tax).toBe(1900);
    expect(sammel.voucher.net).toBe(10769);
    expect(sammel.voucher.taxes).toEqual([
      { rate: 1900, net: 10000, tax: 1900 },
      { rate: 0, net: 769, tax: 0 },
    ]);

    expect(preview.warnings.some((w) => w.includes("Buchungsdatum in 5 Zeilen"))).toBe(true);
  });

  it("behandelt § 13b und innergemeinschaftlichen Erwerb als Nettobeträge", () => {
    const bytes = csvBytes([
      "8;1;10.01.2026;10.01.2026;Software-Lizenz;4806;Wartungskosten;1361;Geldtransit;80,00;0,00;13b 19% And;19,00;USt § 13b;2601-05;03.02.2026;;0",
      "10;1;22.09.2026;22.09.2026;Verbrauchsmaterial EU;4930;Bürobedarf;1200;Bank;55,80;0,00;EU VSt 19 %;19,00;EU USt 19 %;2609-01;06.10.2026;;0",
    ]);

    const preview = previewWisoExport(bytes, "SKR03");
    const reverse = preview.vouchers[0]!;
    expect(reverse.voucher.direction).toBe("ausgabe");
    expect(reverse.voucher.net).toBe(8000);
    expect(reverse.voucher.tax).toBe(1520);
    expect(reverse.voucher.gross).toBe(9520);

    const eu = preview.vouchers[1]!;
    expect(eu.voucher.direction).toBe("ausgabe");
    expect(eu.voucher.net).toBe(5580);
    expect(eu.voucher.tax).toBe(1060);
    expect(eu.voucher.gross).toBe(6640);
  });

  it("funktioniert im SKR04 für Erlös- und Aufwandskonten", () => {
    const bytes = csvBytes([
      "1;1;15.03.2026;15.03.2026;Beratung;4400;Erlöse 19 % USt;1800;Bank;0,00;119,00;USt 19 %;19,00;USt 19 %;R1;15.03.2026;;0",
      "2;1;16.03.2026;16.03.2026;Büro;6815;Bürobedarf;1800;Bank;23,80;0,00;VSt 19 %;19,00;VSt 19 %;E1;16.03.2026;;0",
    ]);

    const preview = previewWisoExport(bytes, "SKR04");
    expect(preview.vouchers[0]!.voucher.direction).toBe("einnahme");
    expect(preview.vouchers[1]!.voucher.direction).toBe("ausgabe");
  });

  it("lehnt ungültige Spaltenköpfe und fehlende Datenzeilen ab", () => {
    const badHeader = new TextEncoder().encode("Datum;Betrag\n01.01.2026;10,00");
    expect(() => previewWisoExport(badHeader, "SKR03")).toThrow(WisoParseError);

    const emptyRows = new TextEncoder().encode(HEADER);
    expect(() => previewWisoExport(emptyRows, "SKR03")).toThrow(WisoParseError);
  });

  it("erkennt Vorzeichen und Sachkonto korrekt, wenn Bank in Konto und Erlös/Aufwand in Gegenkonto steht", () => {
    const bytes = csvBytes([
      "1;1;05.01.2026;05.01.2026;Honorar;1200;Bank;8400;Erlöse 19 % USt;119,00;0,00;USt 19 %;19,00;Umsatzsteuer 19 %;R1;05.01.2026;;0",
      "2;1;06.01.2026;06.01.2026;Werbung;1200;Bank;4600;Werbekosten;0,00;119,00;VSt 19 %;19,00;Vorsteuer 19 %;E1;06.01.2026;;0",
    ]);
    const preview = previewWisoExport(bytes, "SKR03");
    expect(preview.vouchers[0]!.voucher.type).toBe("salesinvoice");
    expect(preview.vouchers[0]!.voucher.gross).toBe(11900);
    expect(preview.vouchers[0]!.voucher.categories[0]!.categoryId).toBe("8400");
    expect(preview.vouchers[1]!.voucher.type).toBe("purchaseinvoice");
    expect(preview.vouchers[1]!.voucher.gross).toBe(11900);
    expect(preview.vouchers[1]!.voucher.categories[0]!.categoryId).toBe("4600");
  });

  it("rundet Steuer bei §-13b-Storno symmetrisch zur Null (Beleg + Storno = 0)", () => {
    const bytes = csvBytes([
      "1;1;10.01.2026;10.01.2026;Lizenz;4806;Wartung;1200;Bank;0,50;0,00;13b 19% And;19,00;USt § 13b;B1;10.01.2026;;0",
      "2;1;11.01.2026;11.01.2026;Storno Lizenz;4806;Wartung;1200;Bank;-0,50;0,00;13b 19% And;19,00;USt § 13b;B2;11.01.2026;;0",
    ]);
    const preview = previewWisoExport(bytes, "SKR03");
    const sumTax = preview.vouchers[0]!.voucher.tax + preview.vouchers[1]!.voucher.tax;
    expect(preview.vouchers[0]!.voucher.tax).toBe(10);
    expect(preview.vouchers[1]!.voucher.tax).toBe(-10);
    expect(sumTax).toBe(0);
  });

  it("addiert bei einer Splittbuchung mit Erlös und Ausgabe nicht die Ausgabe auf die Einnahme", () => {
    const bytes = csvBytes([
      "50;1;20.02.2026;20.02.2026;Zahlungseingang;8400;Erlöse 19 % USt;1200;Bank;0,00;100,00;USt 19 %;19,00;Umsatzsteuer 19 %;R50;20.02.2026;;0",
      "50;2;20.02.2026;20.02.2026;Gebühr;4970;Nebenkosten des Geldverkehrs;1200;Bank;5,00;0,00;;0,00;;R50;20.02.2026;;0",
    ]);
    const preview = previewWisoExport(bytes, "SKR03");
    expect(preview.vouchers[0]!.voucher.gross).toBe(9500);
  });
});
