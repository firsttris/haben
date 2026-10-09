import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datevAccountTotals, DatevParseError, isDatevFile, parseDatevBuchungsstapel } from "./index.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));

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

describe("parseDatevBuchungsstapel", () => {
  it("lehnt andere DATEV-Formate mit Namen ab", () => {
    const header = HEADER.replace(`700;21;"Buchungsstapel"`, `700;16;"Debitoren/Kreditoren"`);
    expect(message(() => parseDatevBuchungsstapel(file(header, COLUMNS)))).toBe(
      "Das ist ein DATEV-Export „Debitoren/Kreditoren“, kein Buchungsstapel.",
    );
  });

  it("lehnt Dateien ohne EXTF ab", () => {
    expect(message(() => parseDatevBuchungsstapel(file("Datum;Betrag", "01.01.2025;1,00")))).toBe(
      "Keine DATEV-Datei: Kopfzeile beginnt nicht mit EXTF",
    );
  });

  it("nennt eine fehlende Pflichtspalte", () => {
    const columns = COLUMNS.replace(`"Belegdatum";`, "");
    expect(message(() => parseDatevBuchungsstapel(file(HEADER, columns)))).toBe(
      "Zeile 2: Spalte „Belegdatum“ fehlt.",
    );
  });

  it("erkennt Spalten unabhängig von Reihenfolge, Groß-/Kleinschreibung und Leerraum", () => {
    const columns = `"Belegdatum";" konto ";"GEGENKONTO  (ohne BU-Schlüssel)";"Soll/Haben-Kennzeichen";"Umsatz (ohne Soll/Haben-Kz)"`;
    const stack = parseDatevBuchungsstapel(file(HEADER, columns, `0102;1200;8400;"H";10,5`));
    expect(stack.bookings[0]).toMatchObject({ amount: 1050, side: "H", account: "1200", contraAccount: "8400", date: "2025-02-01" });
  });

  it("meldet ein ungültiges Soll/Haben-Kennzeichen mit Zeilennummer", () => {
    const bytes = file(HEADER, COLUMNS, `10,00;"S";1200;8400;;0101;"ok"`, "", `10,00;"X";1200;8400;;0101;"falsch"`);
    expect(message(() => parseDatevBuchungsstapel(bytes))).toBe(
      "Zeile 5: Soll/Haben-Kennzeichen „X“ ist weder S noch H.",
    );
  });

  it("lehnt negative Umsätze ab und warnt bei 0,00", () => {
    expect(message(() => parseDatevBuchungsstapel(file(HEADER, COLUMNS, `-10,00;"S";1200;8400;;0101;""`)))).toMatch(
      /^Zeile 3: negativer Umsatz/,
    );
    const stack = parseDatevBuchungsstapel(file(HEADER, COLUMNS, `0,00;"S";1200;8400;;0101;""`, ""));
    expect(stack.bookings).toHaveLength(1);
    expect(stack.warnings).toEqual(["Zeile 3: Umsatz ist 0,00."]);
  });

  it("meldet ein unmögliches Belegdatum", () => {
    expect(message(() => parseDatevBuchungsstapel(file(HEADER, COLUMNS, `1,00;"S";1200;8400;;3102;""`)))).toBe(
      "Zeile 3: ungültiges Belegdatum „3102“.",
    );
  });

  it("weicht auf das andere Jahr des Zeitraums aus oder warnt", () => {
    // Zeitraum 01.12.2024–31.01.2025, WJ-Beginn 01.01.2025: Dezember gehört ins Vorjahr
    const header = HEADER.replace("20250101;4;20250101;20251231", "20250101;4;20241201;20250131");
    const stack = parseDatevBuchungsstapel(file(header, COLUMNS, `1,00;"S";1200;8400;;1512;""`, `1,00;"S";1200;8400;;1506;""`));
    expect(stack.bookings.map((b) => b.date)).toEqual(["2024-12-15", "2025-06-15"]);
    expect(stack.warnings).toEqual(["Zeile 4: Belegdatum 2025-06-15 liegt außerhalb des Zeitraums 2024-12-01 bis 2025-01-31."]);
  });

  it("akzeptiert Belegdatum mit Jahr und Zeilenumbrüche im Text", () => {
    const stack = parseDatevBuchungsstapel(
      file(HEADER, COLUMNS, `1,00;"S";1200;8400;;31122025;"zwei\nZeilen"`, `2,00;"S";1200;8400;;0101;""`),
    );
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
