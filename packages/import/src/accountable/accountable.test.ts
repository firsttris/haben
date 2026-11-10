import { EXPENSE_CATEGORIES } from "@haben/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { categoryForCode, mapAccountableExport, taxFromGross } from "./map.ts";
import { readAccountableExport } from "./source.ts";
import { readXlsxSheet } from "./xlsx.ts";

/**
 * Der Test baut einen Export nach, wie ihn Accountable liefert: äußerer ZIP mit
 * `datev_skr03_…/EXTF…csv`, `…/Belege.zip`, `PDF/Einkäufe/…` und auf Wunsch `Daten.xlsx`.
 * Die Buchungen decken die Fälle ab, die der Umzug unterscheiden muss: Ausgabe mit BU-Schlüssel,
 * Ausgabe ohne Beleglink, Privatzeile und Ausgangsrechnung — dazu die Verknüpfung mit der
 * `Daten.xlsx` (Kategorie, Lieferant, Bezahlt/Zahlungsdatum).
 */

const KOPF = '"EXTF";700;21;"Buchungsstapel";9;20261110112213284;"";"AC";"Test";"";"9999999";"12345";20250101;4;"20250101";"20251231";"Accountable";"SW";1;';
const SPALTEN =
  "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Beleglink";

const zeile = (betrag: string, seite: string, gegen: string, bu: string, ttmm: string, nr: string, beleg2: string, text: string, link = "") =>
  [betrag, seite, "EUR", "", betrag, "EUR", "1200", gegen, bu, ttmm, nr, beleg2, "", text, link].join(";");

const BUCHUNGEN = [
  zeile("92,81", "H", "4806", "9", "0601", "06012025_9281", "06012025", "ER Serverprofis GmbH", '"BEDI ""guid-rechnung"""'),
  zeile("10,00", "H", "4964", "506", "0101", "01012025_1000", "01012025", "ER Bitwarden Inc."),
  zeile("271,40", "H", "1801", "", "1903", "19032025_27140", "19032025", "ER Nbb Notebooksbilliger.de"),
  zeile("833,00", "S", "8400", "", "1211", "2025-001", "06112025", "AR Pro-Tec-Services GmbH"),
  // Konto 1800 ist Privatentnahme allgemein — darf kein Betriebsbeleg werden
  zeile("99,95", "H", "1800", "", "2011", "20112025_9995", "20112025", "Privat"),
];

/** Buchungen für den Abgleich mit `Daten.xlsx` */
const BUCHUNGEN_MIT_DATEN = [
  // Belegfeld 1 passt genau auf die Zeile
  zeile("92,81", "H", "4806", "9", "0601", "06012025_9281", "06012025", "ER Serverprofis GmbH"),
  // Belegfeld 1 passt nicht: der Abgleich muss über Datum und Betrag greifen
  zeile("10,00", "H", "4964", "506", "0101", "01012025_9999", "01012025", "ER Bitwarden Inc."),
  // Nicht bezahlt, Code kennt Haben nicht
  zeile("50,00", "H", "4920", "9", "1503", "15032025_5000", "15032025", "ER Telekom Deutschland GmbH"),
  // Ohne Betrag ohne USt. in der Zeile: die Beträge kommen aus dem Stapel
  zeile("1650,00", "H", "4288", "", "3112", "31122025_165000", "31122025", "ER Hausverwaltung"),
];

/**
 * Kopfzeile des Sheets „Ausgaben“ — dieselben Spalten wie im Export, damit die Buchstaben
 * (A, C, E, F, G, H, J, M, N, Q, R, Y) im Test dieselben bleiben.
 */
const AUSGABEN_KOPF = [
  "Buchungsdatum",
  "Kodierungsdatum",
  "Name Des Lieferanten",
  "Region Des Lieferanten",
  "Gesamtbetrag",
  "Betrag Ohne USt.",
  "USt.-Betrag",
  "Währung",
  "USt.-Status",
  "USt.-Satz",
  "Geschäftliche Nutzung",
  "Über X Monate Abgeschrieben",
  "Buchungscode",
  "Codebeschreibung",
  "Storno-Rechnung",
  "Kontobewegungen",
  "Bezahlt",
  "Zahlungsdatum",
  "Einkommensteuerabzugsfähigkeit",
  "Vorsteuerabzugsfähigkeit %",
  "Erstattungsfähige MwSt.",
  "Umsatzsteuer",
  "USt.-Zeitraum",
  "Lokaler Umsatzsteuersatz",
  "Dokument Vorhanden",
];

interface Ausgabe {
  datum: string;
  lieferant: string;
  brutto: string;
  netto?: string;
  steuer?: string;
  waehrung?: string;
  satz?: string;
  code: string;
  name: string;
  bezahlt?: string;
  zahlungsdatum?: string;
  dokument?: string;
}

/** Eine Zeile an die Spaltenstellen A…Y legen, die der Export belegt */
function ausgabe(entry: Ausgabe): string[] {
  const row = Array<string>(AUSGABEN_KOPF.length).fill("");
  row[0] = entry.datum;
  row[2] = entry.lieferant;
  row[4] = entry.brutto;
  row[5] = entry.netto ?? "";
  row[6] = entry.steuer ?? "";
  row[7] = entry.waehrung ?? "EUR";
  row[9] = entry.satz ?? "";
  row[12] = entry.code;
  row[13] = entry.name;
  row[16] = entry.bezahlt ?? "Ja";
  row[17] = entry.zahlungsdatum ?? entry.datum;
  row[24] = entry.dokument ?? "Ja";
  return row;
}

const AUSGABEN = [
  ausgabe({
    datum: "06.01.2025",
    lieferant: "Serverprofis Hosting GmbH",
    brutto: "92.81",
    netto: "77.99",
    steuer: "14.82",
    satz: "0.19",
    code: "4806",
    name: "Hosting",
  }),
  ausgabe({ datum: "01.01.2025", lieferant: "Bitwarden Inc.", brutto: "10", netto: "8.40", steuer: "1.60", satz: "0.19", code: "4964", name: "Software-Abo" }),
  ausgabe({
    datum: "15.03.2025",
    lieferant: "Telekom Deutschland GmbH",
    brutto: "50",
    netto: "42.02",
    steuer: "7.98",
    satz: "0.19",
    code: "9999",
    name: "Unbekannt",
    bezahlt: "Nein",
    zahlungsdatum: "",
    dokument: "Nein",
  }),
  ausgabe({
    datum: "31.12.2025",
    lieferant: "Hausverwaltung Berger",
    brutto: "1650",
    code: "4288",
    name: "Nebenkosten (Hauptarbeitsplatz in Wohnung)",
    dokument: "Nein",
  }),
];

/**
 * Baut eine `Daten.xlsx` mit dem Sheet „Ausgaben“ und einem zweiten Sheet. `mode` schaltet
 * zwischen geteilten Zeichenketten (`sharedStrings.xml`, so schreibt Excel) und eingebetteten
 * (`inlineStr`) um — die echte Datei nutzt keine von beiden, sondern `t="str"`; alle drei Wege
 * müssen gelesen werden.
 */
function xlsx(rows: string[][], mode: "shared" | "inline" = "shared"): Uint8Array {
  const written: string[] = [];
  const cell = (value: string, row: number, column: number) => {
    if (value === "") return "";
    const ref = `${String.fromCharCode(64 + column)}${row}`;
    if (mode === "inline") return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
    written.push(value);
    return `<c r="${ref}" t="s"><v>${written.length - 1}</v></c>`;
  };
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map((row, index) => `<row r="${index + 1}">${row.map((value, column) => cell(value, index + 1, column + 1)).join("")}</row>`)
    .join("")}</sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        '<sheet name="Ausgaben" sheetId="1" r:id="rId1"/><sheet name="Rechnungen" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        "</Relationships>",
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/worksheets/sheet2.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="str"><v>Rechnungsnummer</v></c></row>' +
        '<row r="2"><c r="A2" t="str"><v>2025-001</v></c></row></sheetData></worksheet>',
    ),
    ...(mode === "shared"
      ? {
          "xl/sharedStrings.xml": strToU8(
            `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${written.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`,
          ),
        }
      : {}),
  });
}

function export_(documentXml: string, daten?: Uint8Array, bookings: string[] = BUCHUNGEN): Uint8Array {
  const belege = zipSync({
    "document.xml": strToU8(documentXml),
    "beleg-rechnung.pdf": strToU8("%PDF-1.4 beleg"),
  });
  return zipSync({
    "datev_skr03_10112026/EXTF_Buchungsstapel_2025Test.csv": strToU8([KOPF, SPALTEN, ...bookings].join("\n")),
    "datev_skr03_10112026/Belege.zip": belege,
    "PDF/Einkäufe/beleg-rechnung_Wdn.pdf": strToU8("%PDF-1.4 beleg"),
    ...(daten ? { "Daten.xlsx": daten } : {}),
  });
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://xml.datev.de/bedi/tps/document/v04.0" generatingSystem="Accountable" version="4.0">
  <content>
    <document type="1" processID="1" guid="guid-rechnung">
      <extension xsi:type="File" name="beleg-rechnung.pdf"/>
    </document>
  </content>
</archive>`;

describe("Accountable-Export lesen", () => {
  it("findet Buchungsstapel und Beleg über die GUID", () => {
    const exp = readAccountableExport(export_(XML));
    expect(exp.stack.bookings).toHaveLength(5);
    expect(exp.stack.header.fiscalYearStart).toBe("2025-01-01");
    expect(exp.receipts).toHaveLength(1);
    expect(exp.receiptByGuid.get("guid-rechnung")?.name).toBe("beleg-rechnung.pdf");
    expect(exp.expenses).toEqual([]);
    expect(exp.warnings).toEqual([]);
  });

  it("meldet einen Beleg, der in document.xml steht, aber als Datei fehlt", () => {
    const exp = readAccountableExport(export_(XML.replace("beleg-rechnung.pdf", "fehlt.pdf")));
    expect(exp.receipts).toHaveLength(0);
    expect(exp.warnings.join(" ")).toContain("fehlt.pdf");
  });

  it("bricht ohne Buchungsstapel mit klarer Meldung ab", () => {
    const ohneStapel = zipSync({ "Daten.xlsx": strToU8("leer") });
    expect(() => readAccountableExport(ohneStapel)).toThrow(/EXTF/);
  });

  it("liest die Zeilen des Sheets „Ausgaben“ aus Daten.xlsx", () => {
    const exp = readAccountableExport(export_(XML, xlsx([AUSGABEN_KOPF, ...AUSGABEN])));
    expect(exp.expenses).toHaveLength(4);
    expect(exp.expenses[0]).toEqual({
      bookingDate: "2025-01-06",
      supplierName: "Serverprofis Hosting GmbH",
      gross: 9281,
      net: 7799,
      tax: 1482,
      currency: "EUR",
      taxRate: 1900,
      code: "4806",
      codeName: "Hosting",
      paid: true,
      paidDate: "2025-01-06",
      documentPresent: true,
      row: 2,
    });
    expect(exp.warnings).toEqual([]);
  });
});

describe("Daten.xlsx lesen", () => {
  const rows = [AUSGABEN_KOPF, ...AUSGABEN];

  it("liest geteilte und eingebettete Zeichenketten, Spalten über den Kopf", () => {
    for (const mode of ["shared", "inline"] as const) {
      const sheet = readXlsxSheet(xlsx(rows, mode), "Ausgaben");
      expect(sheet).toHaveLength(4);
      expect(sheet[0]?.["Name Des Lieferanten"]).toBe("Serverprofis Hosting GmbH");
      // führende Null bleibt: der Code ist Text, keine Zahl
      expect(sheet[0]?.Buchungscode).toBe("4806");
      expect(sheet[3]?.Bezahlt).toBe("Ja");
    }
  });

  it("wählt das Sheet über seinen Namen und liefert für ein unbekanntes Sheet nichts", () => {
    expect(readXlsxSheet(xlsx(rows), "Rechnungen")).toEqual([{ Rechnungsnummer: "2025-001" }]);
    expect(readXlsxSheet(xlsx(rows), "Gibt es nicht")).toEqual([]);
  });

  it("überspringt leere Zeilen und füllt fehlende Zellen leer", () => {
    const sheet = readXlsxSheet(xlsx([AUSGABEN_KOPF, AUSGABEN[3]!, []]), "Ausgaben");
    expect(sheet).toHaveLength(1);
    expect(sheet[0]?.["Betrag Ohne USt."]).toBe("");
    expect(sheet[0]?.["Dokument Vorhanden"]).toBe("Nein");
  });
});

describe("Buchung und Daten.xlsx-Zeile verknüpfen", () => {
  for (const mode of ["shared", "inline"] as const) {
    describe(mode === "shared" ? "mit sharedStrings" : "mit inlineStr", () => {
      const exp = readAccountableExport(export_(XML, xlsx([AUSGABEN_KOPF, ...AUSGABEN], mode), BUCHUNGEN_MIT_DATEN));
      const mapping = mapAccountableExport(exp);

      it("trifft die Zeile über Belegfeld 1", () => {
        const hosting = mapping.vouchers[0]!;
        expect(hosting.expenseRow).toBe(2);
        // Der Lieferantenname kommt aus der Zeile, nicht aus dem Buchungstext
        expect(hosting.supplierName).toBe("Serverprofis Hosting GmbH");
        expect(hosting.category).toBe("edv");
        expect(hosting.paid).toBe(true);
        expect(hosting.paidDate).toBe("2025-01-06");
        expect(hosting.documentPresent).toBe(true);
      });

      it("greift auf Datum und Betrag zurück, wenn Belegfeld 1 nicht passt", () => {
        const software = mapping.vouchers[1]!;
        expect(software.invoiceNumber).toBe("01012025_9999");
        expect(software.expenseRow).toBe(3);
        expect(software.category).toBe("software");
      });

      it("übernimmt die Beträge der Zeile, wenn sie in sich stimmen", () => {
        const software = mapping.vouchers[1]!;
        expect(software.gross).toBe(1000);
        expect(software.net).toBe(840);
        expect(software.tax).toBe(160);
        expect(software.taxRate).toBe(1900);
      });

      it("nimmt Bezahlt und Zahlungsdatum aus der Zeile", () => {
        const telekom = mapping.vouchers[2]!;
        expect(telekom.paid).toBe(false);
        expect(telekom.paidDate).toBeNull();
        expect(telekom.documentPresent).toBe(false);
      });

      it("meldet einen unbekannten Buchungscode und nimmt sonstiges", () => {
        expect(mapping.vouchers[2]?.category).toBe("sonstiges");
        expect(mapping.warnings).toHaveLength(1);
        expect(mapping.warnings[0]).toContain("9999");
        expect(mapping.warnings[0]).toContain("Sonstiger Aufwand");
      });

      it("lässt die Beträge aus dem Stapel, wenn die Zeile keine USt. nennt", () => {
        const miete = mapping.vouchers[3]!;
        expect(miete.category).toBe("miete");
        expect(miete.gross).toBe(165000);
        expect(miete.net).toBe(165000);
        expect(miete.tax).toBe(0);
      });
    });
  }

  it("rät nicht, wenn Datum und Betrag auf mehrere Zeilen passen", () => {
    const doppelt = [
      ausgabe({
        datum: "20.05.2025",
        lieferant: "Erste Firma",
        brutto: "12.00",
        netto: "10.08",
        steuer: "1.92",
        satz: "0.19",
        code: "0490",
        name: "Elektronik/IT",
      }),
      ausgabe({
        datum: "20.05.2025",
        lieferant: "Zweite Firma",
        brutto: "12.00",
        netto: "10.08",
        steuer: "1.92",
        satz: "0.19",
        code: "0420",
        name: "Büroeinrichtung",
      }),
    ];
    const nurEine = [zeile("12,00", "H", "4964", "9", "2005", "20052025_9999", "20052025", "ER Irgendwas")];
    const mapping = mapAccountableExport(readAccountableExport(export_(XML, xlsx([AUSGABEN_KOPF, ...doppelt]), nurEine)));
    expect(mapping.vouchers[0]?.expenseRow).toBeNull();
    expect(mapping.vouchers[0]?.category).toBeNull();
    expect(mapping.vouchers[0]?.supplierName).toBe("Irgendwas");
    expect(mapping.warnings.join(" ")).toContain("2 Zeilen");
  });

  it("bildet jeden Buchungscode auf eine Kategorie ab, die Haben kennt", () => {
    const codes = ["0420", "4280", "4288", "4670", "4806", "4909", "4910", "4920", "4925", "4930", "4964", "4970", "0480", "0490"];
    for (const code of codes) {
      const category = categoryForCode(code, 1000);
      expect(category, code).not.toBeNull();
      expect(Object.hasOwn(EXPENSE_CATEGORIES, category!), code).toBe(true);
    }
    expect(categoryForCode("0420", 1000)).toBe("buero");
    expect(categoryForCode("4910", 1000)).toBe("porto");
    expect(categoryForCode("4970", 1000)).toBe("geldverkehr");
    expect(categoryForCode("9999", 1000)).toBeNull();
  });

  it("entscheidet bei 0490 über den Netto-Betrag: GWG oder Anlagegut", () => {
    expect(categoryForCode("0490", 800_00)).toBe("hardware");
    expect(categoryForCode("0490", 800_01)).toBe("anlage");

    const kauf = [
      ausgabe({
        datum: "10.02.2025",
        lieferant: "Kleingerät",
        brutto: "119.00",
        netto: "100.00",
        steuer: "19.00",
        satz: "0.19",
        code: "0490",
        name: "Elektronik/IT",
      }),
      ausgabe({
        datum: "11.02.2025",
        lieferant: "Notebook",
        brutto: "1190.00",
        netto: "1000.00",
        steuer: "190.00",
        satz: "0.19",
        code: "0490",
        name: "Elektronik/IT",
      }),
    ];
    const bookings = [
      zeile("119,00", "H", "0490", "9", "1002", "10022025_11900", "10022025", "ER Kleingerät"),
      zeile("1190,00", "H", "0490", "9", "1102", "11022025_119000", "11022025", "ER Notebook"),
    ];
    const mapping = mapAccountableExport(readAccountableExport(export_(XML, xlsx([AUSGABEN_KOPF, ...kauf]), bookings)));
    expect(mapping.vouchers[0]?.net).toBe(10000);
    expect(mapping.vouchers[0]?.category).toBe("hardware");
    expect(mapping.vouchers[1]?.net).toBe(100000);
    expect(mapping.vouchers[1]?.category).toBe("anlage");
    // Jede erzeugte Kategorie ist ein Schlüssel aus EXPENSE_CATEGORIES
    for (const voucher of mapping.vouchers) expect(Object.hasOwn(EXPENSE_CATEGORIES, voucher.category!)).toBe(true);
  });

  it("bleibt ohne Daten.xlsx bei den Angaben des Stapels", () => {
    const mapping = mapAccountableExport(readAccountableExport(export_(XML, undefined, BUCHUNGEN_MIT_DATEN)));
    const hosting = mapping.vouchers[0]!;
    expect(hosting.category).toBeNull();
    expect(hosting.expenseRow).toBeNull();
    expect(hosting.supplierName).toBe("Serverprofis GmbH");
    // Der Stapel bucht zahlungsbasiert über 1200: ohne Daten.xlsx gilt der Beleg als bezahlt
    expect(hosting.paid).toBe(true);
    expect(hosting.paidDate).toBeNull();
  });

  it("nimmt Beträge in Fremdwährung nicht als Euro", () => {
    const fremd = [...AUSGABEN];
    fremd[1] = ausgabe({
      datum: "01.01.2025",
      lieferant: "Bitwarden Inc.",
      brutto: "10",
      netto: "8.40",
      steuer: "1.60",
      waehrung: "USD",
      satz: "0.19",
      code: "4964",
      name: "Software-Abo",
    });
    const mapping = mapAccountableExport(readAccountableExport(export_(XML, xlsx([AUSGABEN_KOPF, ...fremd]), BUCHUNGEN_MIT_DATEN)));
    // BU-Schlüssel 506: der Stapel hat 10,00 € ohne Steueranteil — der Dollar-Betrag bleibt draußen
    expect(mapping.vouchers[1]?.gross).toBe(1000);
    expect(mapping.vouchers[1]?.tax).toBe(0);
    expect(mapping.vouchers[1]?.category).toBe("software");
  });
});

describe("Buchungen auf Belege abbilden", () => {
  const exp = readAccountableExport(export_(XML));
  const mapping = mapAccountableExport(exp);

  it("übernimmt Ausgaben, zählt Privatzeilen und trennt Ausgangsrechnungen", () => {
    expect(mapping.vouchers).toHaveLength(2);
    expect(mapping.privateRows).toBe(2);
    expect(mapping.invoices).toHaveLength(1);
    expect(mapping.invoices[0]?.number).toBe("2025-001");
    expect(mapping.missingReceipts).toBe(0);
    expect(mapping.warnings).toEqual([]);
  });

  it("rechnet die Steuer aus dem Bruttobetrag und dem BU-Schlüssel", () => {
    const rechnung = mapping.vouchers[0]!;
    expect(rechnung.gross).toBe(9281);
    expect(rechnung.taxRate).toBe(1900);
    expect(rechnung.tax).toBe(1482);
    expect(rechnung.net).toBe(7799);
    expect(rechnung.supplierName).toBe("Serverprofis GmbH");
    expect(rechnung.guid).toBe("guid-rechnung");
    expect(rechnung.invoiceNumber).toBe("06012025_9281");
    expect(rechnung.documentDate).toBe("2025-01-06");
  });

  it("lässt unbekannte BU-Schlüssel ohne Steueranteil und ohne Rate", () => {
    const unbekannt = mapping.vouchers[1]!;
    expect(unbekannt.taxRate).toBe(0);
    expect(unbekannt.tax).toBe(0);
    expect(unbekannt.net).toBe(unbekannt.gross);
  });

  it("meldet eine Buchung mit Beleglink, dessen GUID im Export fehlt", () => {
    const ohneBeleg = readAccountableExport(export_(XML.replace("guid-rechnung", "andere-guid")));
    expect(mapAccountableExport(ohneBeleg).missingReceipts).toBe(1);
  });
});

describe("Steuer aus Brutto", () => {
  it("rechnet 19 % und 7 % auf ganze Cent", () => {
    expect(taxFromGross(9281, 1900)).toEqual({ net: 7799, tax: 1482 });
    expect(taxFromGross(10700, 700)).toEqual({ net: 10000, tax: 700 });
    expect(taxFromGross(100, 1900)).toEqual({ net: 84, tax: 16 });
  });
});

describe("Accountable-Export in SKR04 (Review #579)", () => {
  // SKR04: Bank 1800, Privatentnahmen 2100, Privateinlagen 2180, Geldtransit 1460 (Kontenrahmen in packages/core/src/posting.ts)
  const zeile04 = (betrag: string, gegen: string, ttmm: string, nr: string, text: string) =>
    [betrag, "H", "EUR", "", betrag, "EUR", "1800", gegen, "", ttmm, nr, `${ttmm}2025`, "", text, ""].join(";");

  function export04(bookings: string[]): Uint8Array {
    return zipSync({
      "datev_skr04_10112026/EXTF_Buchungsstapel_2025Test.csv": strToU8([KOPF, SPALTEN, ...bookings].join("\n")),
      "datev_skr04_10112026/Belege.zip": zipSync({ "document.xml": strToU8(XML), "beleg-rechnung.pdf": strToU8("%PDF-1.4 beleg") }),
    });
  }

  it("erkennt Privatentnahme und Geldtransit im SKR04 und legt dafür keinen Beleg an", () => {
    const mapping = mapAccountableExport(
      readAccountableExport(
        export04([zeile04("271,40", "2100", "1903", "19032025_27140", "Privatentnahme"), zeile04("50,00", "1460", "2003", "20032025_5000", "Umbuchung")]),
      ),
    );
    expect(mapping.privateRows).toBe(2);
    expect(mapping.vouchers).toEqual([]);
  });
});

describe("Privateinlage im Accountable-Stapel (Review #579, Runde 2)", () => {
  it("zählt eine Privateinlage (S auf 1200 gegen 1890) als Privatzeile und nicht als Ausgangsrechnung", () => {
    // Einlage des Inhabers: Geld kommt aufs Bankkonto, Gegenkonto 1890 (SKR03 Privateinlagen). Keine Rechnung.
    const einlage = zeile("500,00", "S", "1890", "", "0102", "01022025_50000", "01022025", "Privateinlage");
    const mapping = mapAccountableExport(readAccountableExport(export_(XML, undefined, [einlage])));
    expect(mapping.invoices).toEqual([]);
    expect(mapping.privateRows).toBe(1);
  });
});
