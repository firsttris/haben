import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datevAccountTotals, DatevParseError, datevYearSums, isDatevFile, otherDatevExportName, parseDatevBuchungsstapel } from "./index.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));

const HEADER = `"EXTF";700;21;"Buchungsstapel";13;20260102120000000;;"LO";"";"";1001;12345;20250101;4;20250101;20251231;"Test";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
const COLUMNS = `"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen";"Konto";"Gegenkonto (ohne BU-Schlüssel)";"BU-Schlüssel";"Belegdatum";"Buchungstext"`;
const file = (...lines: string[]) => new TextEncoder().encode(lines.join("\n"));
const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DatevParseError);
    return (e as Error).message;
  }
  throw new Error("kein Fehler");
};

describe("DATEV-Buchungsstapel (Windows-1252, Lexoffice)", () => {
  const stack = parseDatevBuchungsstapel(fixture("datev-buchungsstapel.csv"));
  const [sale, purchase, privat, eu, phone] = stack.bookings;

  it("liest die Kopfzeile", () => {
    expect(stack.header).toEqual({
      formatVersion: 700,
      category: 21,
      formatName: "Buchungsstapel",
      categoryVersion: 13,
      createdAt: "2026-01-02T12:00:00.000",
      beraterNr: "1001",
      mandantNr: "12345",
      fiscalYearStart: "2025-01-01",
      accountLength: 4,
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
      description: "Lexoffice Export",
      currency: "EUR",
      kontenrahmen: "SKR03",
    });
    expect(stack.warnings).toEqual([]);
    expect(stack.bookings).toHaveLength(5);
  });

  it("liest eine Ausgangsrechnung mit Umlauten", () => {
    expect(sale).toMatchObject({
      row: 3,
      amount: 476000,
      side: "S",
      currency: "EUR",
      account: "1200",
      contraAccount: "8400",
      buKey: "",
      date: "2025-03-15",
      voucherField1: "RE-2025-0012",
      voucherField2: "",
      text: "Müller GmbH Beratung März",
      documentLink: "",
      euVatId: "",
      euTaxRate: null,
    });
    expect(sale!.raw).toEqual({
      "Umsatz (ohne Soll/Haben-Kz)": "4760,00",
      "Soll/Haben-Kennzeichen": "S",
      "WKZ Umsatz": "EUR",
      Konto: "1200",
      "Gegenkonto (ohne BU-Schlüssel)": "8400",
      Belegdatum: "1503",
      "Belegfeld 1": "RE-2025-0012",
      Buchungstext: "Müller GmbH Beratung März",
      Festschreibung: "0",
    });
  });

  it("liest BU-Schlüssel, Belegfeld 2 und Kostenstelle", () => {
    expect(purchase).toMatchObject({
      row: 4,
      amount: 11900,
      buKey: "9",
      date: "2025-04-22",
      voucherField2: "220425",
      text: "Bürobedarf Größe XL",
      costCenter1: "100",
      costCenter2: "",
    });
    expect(privat).toMatchObject({ amount: 50000, side: "H", account: "1200", contraAccount: "1800", date: "2025-06-30" });
  });

  it("ergänzt die führende Null im Belegdatum, liest Tausenderpunkt und EU-Felder", () => {
    expect(eu).toMatchObject({
      amount: 123456,
      date: "2025-01-05",
      text: "Österreich AG",
      euVatId: "ATU12345678",
      euTaxRate: 2000,
    });
  });

  it("entschlüsselt verdoppelte Anführungszeichen im Beleglink", () => {
    expect(phone).toMatchObject({
      row: 7,
      date: "2025-12-01",
      text: 'Telekom "MagentaZuhause"',
      documentLink: 'BEDI "8a1f2c3d-0000-4e5f-9a8b-123456789abc"',
    });
  });
});

describe("DATEV-Buchungsstapel (UTF-8 mit BOM, abweichendes Wirtschaftsjahr)", () => {
  const stack = parseDatevBuchungsstapel(fixture("datev-buchungsstapel-utf8.csv"));

  it("liest Kopfzeile und Kontenrahmen", () => {
    expect(stack.header).toMatchObject({
      fiscalYearStart: "2025-07-01",
      dateFrom: "2025-07-01",
      dateTo: "2026-06-30",
      createdAt: "2026-08-15T09:30:00.123",
      kontenrahmen: "SKR04",
      description: "Lexoffice Export WJ 2025/26",
    });
    expect(stack.warnings).toEqual([]);
  });

  it("ordnet Monate vor dem WJ-Beginn dem Folgejahr zu", () => {
    expect(stack.bookings.map((b) => b.date)).toEqual(["2025-08-15", "2026-02-20", "2026-06-30"]);
    expect(stack.bookings[0]!.text).toBe("Kunde Straße Süd");
  });

  it("liest die EU-Spalten der Version 13 und setzt die Währung aus der Kopfzeile", () => {
    expect(stack.bookings[1]).toMatchObject({ euVatId: "FR12345678901", euTaxRate: 2000, currency: "EUR" });
  });
});

describe("otherDatevExportName", () => {
  // EXTF_GP_Stamm_*.csv aus sevDesk: Buchhaltung 1.0 ohne Anführungszeichen, 2.0 mit
  const gpStamm = (version: string) => fixture(`sevdesk/buchhaltung-${version}/extf-gp-stamm.csv`);

  it("nennt die Formatkategorie eines anderen DATEV-Exports", () => {
    expect(otherDatevExportName(gpStamm("1.0"))).toBe("Debitoren/Kreditoren");
    expect(otherDatevExportName(gpStamm("2.0"))).toBe("Debitoren/Kreditoren");
    expect(otherDatevExportName(file(HEADER.replace(`700;21;"Buchungsstapel"`, `700;20;"Kontenbeschriftungen"`), "Konto"))).toBe("Kontenbeschriftungen");
  });

  it("nimmt bei unbekannter Kategorie den Namen aus der Kopfzeile, sonst die Nummer", () => {
    expect(otherDatevExportName(file(`"EXTF";700;99;"Neues Format";1`, "A"))).toBe("Neues Format");
    expect(otherDatevExportName(file(`"EXTF";700;99;"";1`, "A"))).toBe("Kategorie 99");
  });

  it("liest die Kopfzeile auch mit BOM", () => {
    expect(otherDatevExportName(new Uint8Array([0xef, 0xbb, 0xbf, ...gpStamm("1.0")]))).toBe("Debitoren/Kreditoren");
  });

  it("807: ein angeschnittener UTF-8-Umlaut hinter dem Namen ändert dessen Kodierung nicht", () => {
    const prefix = `"EXTF";700;99;"Überweisungsvorlagen";1;"`;
    const bytes = file(`${prefix}${"a".repeat(511 - file(prefix).length)}ä"`, "Kopf", "Inhalt");
    expect([...bytes.subarray(511, 513)]).toEqual([0xc3, 0xa4]);
    expect(otherDatevExportName(bytes)).toBe("Überweisungsvorlagen");
  });

  it("807: liest den vollständigen Namen mit Umlaut über Byte 512 hinweg", () => {
    const prefix = `"EXTF";700;99;"`;
    const name = `${"a".repeat(511 - file(prefix).length)}Überweisungsvorlagen`;
    const bytes = file(`${prefix}${name}";1`, "Kopf", "Inhalt");
    expect([...bytes.subarray(511, 513)]).toEqual([0xc3, 0x9c]);
    expect(otherDatevExportName(bytes)).toBe(name);
  });

  const unicodeName = "Überweisungsvorlagen €";
  const unicodeHeader = `"EXTF";700;99;"${unicodeName}";1\r\nKopf\r\nInhalt\r\n`;
  const utf8 = file(unicodeHeader);
  const utf16 = Buffer.from(unicodeHeader, "utf16le");
  it.each<[string, Uint8Array]>([
    ["UTF-8 ohne BOM", utf8],
    ["UTF-8 mit BOM", new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])],
    ["UTF-16 LE mit BOM", new Uint8Array([0xff, 0xfe, ...utf16])],
    ["UTF-16 BE mit BOM", new Uint8Array([0xfe, 0xff, ...Buffer.from(utf16).swap16()])],
    ["Windows-1252", new Uint8Array([...file(`"EXTF";700;99;"`), 0xdc, ...file("berweisungsvorlagen "), 0x80, ...file(`";1\r\nKopf\r\nInhalt\r\n`)])],
  ])("807: erhält Exportnamen in %s", (_encoding, bytes) => {
    expect(otherDatevExportName(bytes)).toBe(unicodeName);
  });

  it("gibt beim Buchungsstapel null zurück, auch wenn er beschädigt ist", () => {
    expect(otherDatevExportName(file(HEADER, COLUMNS))).toBeNull();
    expect(otherDatevExportName(file(HEADER))).toBeNull();
  });

  it("gibt bei unlesbarer Kategorie null zurück, damit der Parser die Datei ablehnt", () => {
    expect(otherDatevExportName(file(`"EXTF";700;;"Buchungsstapel"`, COLUMNS))).toBeNull();
    expect(otherDatevExportName(file(`"EXTF";700;x1;"Buchungsstapel"`, COLUMNS))).toBeNull();
    expect(otherDatevExportName(file(`"EXTF"`))).toBeNull();
  });

  it("gibt bei anderen Dateien null zurück", () => {
    expect(otherDatevExportName(file("Datum;Betrag", "01.01.2025;1,00"))).toBeNull();
    expect(otherDatevExportName(new Uint8Array())).toBeNull();
  });
});

describe("parseDatevBuchungsstapel", () => {
  it("lehnt andere DATEV-Formate mit Namen ab", () => {
    const header = HEADER.replace(`700;21;"Buchungsstapel"`, `700;16;"Debitoren/Kreditoren"`);
    expect(message(() => parseDatevBuchungsstapel(file(header, COLUMNS)))).toBe("Das ist ein DATEV-Export „Debitoren/Kreditoren“, kein Buchungsstapel.");
  });

  it("lehnt Dateien ohne EXTF ab", () => {
    expect(message(() => parseDatevBuchungsstapel(file("Datum;Betrag", "01.01.2025;1,00")))).toBe("Keine DATEV-Datei: Kopfzeile beginnt nicht mit EXTF");
  });

  it("nennt eine fehlende Pflichtspalte", () => {
    const columns = COLUMNS.replace(`"Belegdatum";`, "");
    expect(message(() => parseDatevBuchungsstapel(file(HEADER, columns)))).toBe("Zeile 2: Spalte „Belegdatum“ fehlt.");
  });

  it("erkennt Spalten unabhängig von Reihenfolge, Groß-/Kleinschreibung und Leerraum", () => {
    const columns = `"Belegdatum";" konto ";"GEGENKONTO  (ohne BU-Schlüssel)";"Soll/Haben-Kennzeichen";"Umsatz (ohne Soll/Haben-Kz)"`;
    const stack = parseDatevBuchungsstapel(file(HEADER, columns, `0102;1200;8400;"H";10,5`));
    expect(stack.bookings[0]).toMatchObject({ amount: 1050, side: "H", account: "1200", contraAccount: "8400", date: "2025-02-01" });
  });

  it("liest die vereinfachten Spaltennamen von Lexware Office", () => {
    const columns = `"Umsatz";"Soll/Haben-Kennzeichen";"WKZ Umsatz";"Kurs";"Basisumsatz";"WKZ Basisumsatz";"Konto";"Gegenkonto";"BU-Schluessel";"Belegdatum";"Belegfeld 1";"Buchungstext";"Faelligkeit"`;
    const stack = parseDatevBuchungsstapel(file(HEADER, columns, `119,00;"S";"EUR";;;;1200;8400;"";0302;"RE-1";"Verkauf";""`));
    expect(stack.bookings[0]).toMatchObject({
      amount: 11900,
      side: "S",
      account: "1200",
      contraAccount: "8400",
      date: "2025-02-03",
      voucherField1: "RE-1",
      text: "Verkauf",
    });
    expect(stack.bookings[0]!.raw).toMatchObject({ Umsatz: "119,00", Gegenkonto: "8400" });
  });

  it("bevorzugt die DATEV-Spalte, wenn es auch eine ohne Klammerzusatz gibt", () => {
    const columns = `"Umsatz";"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen";"Konto";"Gegenkonto (ohne BU-Schlüssel)";"Belegdatum"`;
    const stack = parseDatevBuchungsstapel(file(HEADER, columns, `1,00;2,00;"S";1200;8400;0101`));
    expect(stack.bookings[0]!.amount).toBe(200);
  });

  it("meldet ein ungültiges Soll/Haben-Kennzeichen mit Zeilennummer", () => {
    const bytes = file(HEADER, COLUMNS, `10,00;"S";1200;8400;;0101;"ok"`, "", `10,00;"X";1200;8400;;0101;"falsch"`);
    expect(message(() => parseDatevBuchungsstapel(bytes))).toBe("Zeile 5: Soll/Haben-Kennzeichen „X“ ist weder S noch H.");
  });

  it("lehnt negative Umsätze ab und warnt bei 0,00", () => {
    expect(message(() => parseDatevBuchungsstapel(file(HEADER, COLUMNS, `-10,00;"S";1200;8400;;0101;""`)))).toMatch(/^Zeile 3: negativer Umsatz/);
    const stack = parseDatevBuchungsstapel(file(HEADER, COLUMNS, `0,00;"S";1200;8400;;0101;""`, ""));
    expect(stack.bookings).toHaveLength(1);
    expect(stack.warnings).toEqual(["Zeile 3: Umsatz ist 0,00."]);
  });

  it("meldet ein unmögliches Belegdatum", () => {
    expect(message(() => parseDatevBuchungsstapel(file(HEADER, COLUMNS, `1,00;"S";1200;8400;;3102;""`)))).toBe("Zeile 3: ungültiges Belegdatum „3102“.");
  });

  it("weicht auf das andere Jahr des Zeitraums aus oder warnt", () => {
    // Zeitraum 01.12.2024–31.01.2025, WJ-Beginn 01.01.2025: Dezember gehört ins Vorjahr
    const header = HEADER.replace("20250101;4;20250101;20251231", "20250101;4;20241201;20250131");
    const stack = parseDatevBuchungsstapel(file(header, COLUMNS, `1,00;"S";1200;8400;;1512;""`, `1,00;"S";1200;8400;;1506;""`));
    expect(stack.bookings.map((b) => b.date)).toEqual(["2024-12-15", "2025-06-15"]);
    expect(stack.warnings).toEqual(["Zeile 4: Belegdatum 2025-06-15 liegt außerhalb des Zeitraums 2024-12-01 bis 2025-01-31."]);
  });

  it("akzeptiert Belegdatum mit Jahr und Zeilenumbrüche im Text", () => {
    const stack = parseDatevBuchungsstapel(file(HEADER, COLUMNS, `1,00;"S";1200;8400;;31122025;"zwei\nZeilen"`, `2,00;"S";1200;8400;;0101;""`));
    expect(stack.bookings.map((b) => [b.row, b.date, b.text])).toEqual([
      [3, "2025-12-31", "zwei\nZeilen"],
      [5, "2025-01-01", ""],
    ]);
  });

  it("wertet Anführungszeichen mitten im Feld nicht als Öffner", () => {
    const stack = parseDatevBuchungsstapel(file(HEADER, COLUMNS, `1,00;"S";1200;8400;;0101;Monitor 27"`, `2,00;"S";1200;8400;;0201;"x"`));
    expect(stack.bookings.map((b) => [b.amount, b.text])).toEqual([
      [100, 'Monitor 27"'],
      [200, "x"],
    ]);
  });
});

describe("isDatevFile", () => {
  it("erkennt EXTF und DTVF, mit und ohne Anführungszeichen", () => {
    expect(isDatevFile(fixture("datev-buchungsstapel.csv"))).toBe(true);
    expect(isDatevFile(fixture("datev-buchungsstapel-utf8.csv"))).toBe(true);
    expect(isDatevFile(file("EXTF;700;21"))).toBe(true);
    expect(isDatevFile(file(`"DTVF";700;21`))).toBe(true);
    expect(isDatevFile(fixture("dkb-neu.csv"))).toBe(false);
    expect(isDatevFile(file("EXTFX;700"))).toBe(false);
  });
});

describe("datevAccountTotals", () => {
  it("summiert Soll und Haben je Konto, numerisch sortiert", () => {
    const { bookings } = parseDatevBuchungsstapel(fixture("datev-buchungsstapel.csv"));
    expect(datevAccountTotals(bookings)).toEqual([
      { account: "1200", debit: 476000, credit: 11900 + 50000 },
      { account: "1800", debit: 50000, credit: 0 },
      { account: "4920", debit: 8925, credit: 0 },
      { account: "4930", debit: 11900, credit: 0 },
      { account: "8125", debit: 0, credit: 123456 },
      { account: "8400", debit: 0, credit: 476000 },
      { account: "10001", debit: 123456, credit: 0 },
      { account: "70001", debit: 0, credit: 8925 },
    ]);
  });
});

describe("Jahressummen aus dem Buchungsstapel", () => {
  const b = (amount: number, side: "S" | "H", account: string, contraAccount: string, buKey = "") => ({ amount, side, account, contraAccount, buKey });

  it("rechnet Automatikkonten und BU-Schlüssel brutto in netto und Steuer um (SKR03)", () => {
    const sums = datevYearSums(
      [
        b(11900, "S", "1200", "8400"), // Erlös 19 % über Automatik
        b(10700, "H", "8300", "1200"), // Erlös 7 %, Konto und Gegenkonto vertauscht
        b(5000, "S", "1200", "8120"), // steuerfrei
        b(1190, "S", "4930", "1200", "9"), // Bürobedarf mit 19 % Vorsteuer
        b(2140, "S", "4940", "1200", "08"), // Fachliteratur mit 7 % Vorsteuer, BU zweistellig
        b(1190, "H", "1200", "8400"), // Gutschrift an Kunden
      ],
      "SKR03",
    );
    expect(sums).toEqual({ einnahmen: { net: 10000 + 10000 + 5000 - 1000, tax: 1900 + 700 - 190 }, ausgaben: { net: 1000 + 2000, tax: 190 + 140 } });
  });

  it("nimmt bei BU 40 den Betrag netto und die Steuer von den Steuerkonten (SKR04)", () => {
    const sums = datevYearSums(
      [
        b(10000, "S", "1800", "4400", "40"),
        b(1900, "S", "1800", "3806"),
        b(5000, "S", "6815", "1800"),
        b(950, "S", "1406", "1800"),
        b(300, "S", "1800", "1406"), // Vorsteuerkorrektur
        b(99999, "S", "1800", "2000"), // Privat: zählt nicht
      ],
      "SKR04",
    );
    expect(sums).toEqual({ einnahmen: { net: 10000, tax: 1900 }, ausgaben: { net: 5000, tax: 650 } });
  });
});

describe("Jahressummen aus dem Buchungsstapel: Review", () => {
  const b = (amount: number, side: "S" | "H", account: string, contraAccount: string, buKey = "") => ({ amount, side, account, contraAccount, buKey });

  it("rechnet fünfstellige Automatikkonten (84000, Sachkontenlänge 5) wie 8400 brutto in netto und Steuer um", () => {
    expect(datevYearSums([{ ...b(11900, "S", "12000", "84000"), accountLength: 5 }], "SKR03")).toEqual({
      einnahmen: { net: 10000, tax: 1900 },
      ausgaben: { net: 0, tax: 0 },
    });
  });

  it("zählt Debitoren (fünfstellig bei vierstelligen Sachkonten) nicht als Aufwand", () => {
    // Ausgangsrechnung: Debitor 40000 an Erlöse 8400 (19 %), im Jahr noch nicht bezahlt
    expect(datevYearSums([b(11900, "S", "40000", "8400")], "SKR03")).toEqual({ einnahmen: { net: 10000, tax: 1900 }, ausgaben: { net: 0, tax: 0 } });
  });
});
