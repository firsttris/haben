import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTICLE_FIELDS, articleCandidates } from "./articles.ts";
import { ASSET_FIELDS, assetCandidates } from "./assets.ts";
import { CONTACT_FIELDS, contactCandidates } from "./contacts.ts";
import { type ImportField, suggestMapping } from "./mapping.ts";
import { planCounts, planRows } from "./plan.ts";
import { readCsvTable } from "./read.ts";

function table(text: string) {
  const result = readCsvTable(new TextEncoder().encode(text), { encoding: "auto", delimiter: "auto" });
  if (!result.ok) throw new Error(result.error);
  return result.table;
}

const mapped = (text: string, fields: readonly ImportField[]) => {
  const t = table(text);
  return { t, mapping: suggestMapping(t.header, fields) };
};

describe("Kontakte", () => {
  it("übernimmt den Export aus Lexware Office: Firma oder Person, Adresse, Rolle nach den Nummern, IBAN kompakt", () => {
    const bytes = new Uint8Array(readFileSync(new URL("../../test-fixtures/csv-import/kontakte-windows-1252.csv", import.meta.url)));
    const read = readCsvTable(bytes, { encoding: "auto", delimiter: "auto" });
    if (!read.ok) throw new Error(read.error);
    const rows = contactCandidates(read.table, suggestMapping(read.table.header, CONTACT_FIELDS));
    expect(rows.map((r) => r.errors)).toEqual([[], [], []]);
    expect(rows[0]!.value).toEqual({
      kundennummer: "10001",
      lieferantennummer: "",
      name: "Müller & Söhne GmbH",
      strasse: "Hauptstraße 5",
      plz: "50667",
      ort: "Köln",
      land: "DE",
      email: "rechnung@mueller-soehne.example",
      ustId: "DE136695976",
      iban: "DE89370400440532013000",
      leitwegId: "",
      isCustomer: true,
      isSupplier: false,
    });
    expect(rows[1]!.value).toMatchObject({ name: "Erika Mustermann", land: "DE", isCustomer: true });
    expect(rows[2]!.value).toMatchObject({ name: "Papierwerk Süd AG", land: "DE", isCustomer: false, isSupplier: true, lieferantennummer: "70001" });
  });

  // Mustervorlage, Spalten A bis AF: https://help.lexware.de/de-form/articles/548267-anleitung-zum-import-von-kontakten-kunden-und-lieferanten
  const LEXWARE_VORLAGE = [
    "Firmenname;Steuernummer;Umsatzsteuer ID;Anrede;Vorname;Nachname;Notiz",
    "Straße (Rechnungsadresse);Adresszusatz (Rechnungsadresse);Ort (Rechnungsadresse);PLZ (Rechnungsadresse);Land (Rechnungsadresse)",
    "Straße (Lieferadresse);Adresszusatz (Lieferadresse);Ort (Lieferadresse);PLZ (Lieferadresse);Land (Lieferadresse)",
    "Geschäftlich (Rufnummer);Mobil (Rufnummer);Fax (Rufnummer);Geschäftlich (E-Mail);Privat (E-Mail)",
    "Bankname;Kontoinhaber;IBAN;BIC",
    "Anrede (Ansprechpartner);Vorname (Ansprechpartner);Nachname (Ansprechpartner);Rufnummer (Ansprechpartner);E-Mail (Ansprechpartner)",
  ].join(";");

  it("ordnet die Spalten der Mustervorlage von Lexware Office zu, Rechnungs- vor Lieferadresse", () => {
    const header = table(`Kundennummer;${LEXWARE_VORLAGE}\n10001;A GmbH\n`).header;
    const mapping = suggestMapping(header, CONTACT_FIELDS);
    const column = (key: string) => (mapping[key] === null || mapping[key] === undefined ? null : header[mapping[key]!]);
    expect(Object.fromEntries(CONTACT_FIELDS.map((f) => [f.key, column(f.key)]))).toEqual({
      kundennummer: "Kundennummer",
      lieferantennummer: null,
      firma: "Firmenname",
      vorname: "Vorname",
      nachname: "Nachname",
      strasse: "Straße (Rechnungsadresse)",
      plz: "PLZ (Rechnungsadresse)",
      ort: "Ort (Rechnungsadresse)",
      land: "Land (Rechnungsadresse)",
      email: "Geschäftlich (E-Mail)",
      ustId: "Umsatzsteuer ID",
      iban: "IBAN",
      leitwegId: null,
      rolle: null,
    });
  });

  it("legt Zeilen der Lieferanten-Vorlage ohne Nummer als Lieferanten an", () => {
    const empty = ";".repeat(LEXWARE_VORLAGE.split(";").length - 1);
    const { t, mapping } = mapped(`Lieferantennummer;${LEXWARE_VORLAGE}\n;Papierwerk Süd AG${empty.slice(1)}\n`, CONTACT_FIELDS);
    const [row] = contactCandidates(t, mapping);
    expect(row!.errors).toEqual([]);
    expect(row!.value).toMatchObject({ name: "Papierwerk Süd AG", isCustomer: false, isSupplier: true });
  });

  it("ordnet die Spalten des Kontakt-Exports von Lexware Office zu: Adresse 1 und E-Mail 1, Umsatzsteuernummer", () => {
    // Exportnamen und ihre Entsprechung in der Vorlage:
    // https://help.lexware.de/de-form/articles/548116-kontakte-beim-account-wechsel-ubertragen-export-und-import-in-lexware-office
    const header = [
      "Kundennummer",
      "Lieferantennummer",
      "Firmenname",
      "Anrede",
      "Vorname",
      "Nachname",
      "Steuernummer",
      "Umsatzsteuernummer",
      "Adresszusatz 1",
      "Straße 1",
      "PLZ 1",
      "Ort 1",
      "Land 1",
      "Adresszusatz 2",
      "Straße 2",
      "PLZ 2",
      "Ort 2",
      "Land 2",
      "Telefon 1",
      "Telefon 2",
      "E-Mail 1",
      "E-Mail 2",
      "Ansprechpartner 1 Anrede",
      "Ansprechpartner 1 Vorname",
      "Ansprechpartner 1 Nachname",
      "Ansprechpartner 1 E-Mail",
      "Ansprechpartner 1 Telefon",
    ];
    const mapping = suggestMapping(header, CONTACT_FIELDS);
    const column = (key: string) => (mapping[key] === null || mapping[key] === undefined ? null : header[mapping[key]!]);
    expect([column("strasse"), column("plz"), column("ort"), column("land"), column("email"), column("ustId")]).toEqual([
      "Straße 1",
      "PLZ 1",
      "Ort 1",
      "Land 1",
      "E-Mail 1",
      "Umsatzsteuernummer",
    ]);
  });

  it("meldet je Zeile falsche IBAN, falsche Prüfziffer der USt-IdNr., fehlenden Namen und Formeln", () => {
    const { t, mapping } = mapped(
      [
        "Name;IBAN;USt-IdNr.;Ort",
        "A GmbH;DE89 3704 0044 0532 0130 01;;Köln",
        "B GmbH;;DE136695977;Köln",
        ";;;Köln",
        '"=HYPERLINK(""http://x.example"")";;;Köln',
        "C GmbH;;;=1+1",
      ].join("\n"),
      CONTACT_FIELDS,
    );
    const rows = contactCandidates(t, mapping);
    expect(rows.map((r) => r.value)).toEqual([null, null, null, null, null]);
    expect(rows[0]!.errors).toEqual([expect.stringContaining("IBAN")]);
    expect(rows[1]!.errors).toEqual(["USt-IdNr.: „DE136695977“ hat eine falsche Prüfziffer"]);
    expect(rows[2]!.errors).toEqual(["Name fehlt (Firma oder Vor- und Nachname)"]);
    expect(rows[3]!.errors).toEqual([expect.stringMatching(/^Firma: beginnt mit „=“/)]);
    expect(rows[4]!.errors).toEqual([expect.stringMatching(/^Ort: beginnt mit „=“/)]);
  });

  it("lehnt eine Zeile mit mehr Werten als Spalten ab: ein Trennzeichen ohne Anführungszeichen verschiebt die Werte", () => {
    const { t, mapping } = mapped("Firma;Ort\nMüller; Söhne GmbH;Köln\nA GmbH;Köln;\n", CONTACT_FIELDS);
    const rows = contactCandidates(t, mapping);
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.errors).toEqual([expect.stringContaining("3 Werte, die Kopfzeile 2 Spalten")]);
    // Ein leerer Wert am Ende, wie ihn manche Programme schreiben, verschiebt nichts
    expect(rows[1]!.errors).toEqual([]);
  });

  it("liest die Rolle aus der Spalte, auch beides", () => {
    const { t, mapping } = mapped("Name;Typ\nA;Kunde\nB;Lieferant\nC;Kunde und Lieferant\nD;Partner\n", CONTACT_FIELDS);
    const rows = contactCandidates(t, mapping);
    expect(rows.slice(0, 3).map((r) => [r.value?.isCustomer, r.value?.isSupplier])).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
    expect(rows[3]!.errors).toEqual([expect.stringContaining("Rolle: „Partner“")]);
  });

  it("überspringt Dubletten gegen den Bestand und innerhalb der Datei, nach Nummer, E-Mail, USt-IdNr. und Name", () => {
    const { t, mapping } = mapped(
      [
        "Kundennummer;Name;E-Mail",
        "10001;Neu GmbH;neu@example.com",
        "K-7;Schon da GmbH;andere@example.com",
        "10003;Anders GmbH;Info@Bestand.example",
        "10004;Neu GmbH;zweite@example.com",
        "10005;Ganz neu GmbH;",
      ].join("\n"),
      CONTACT_FIELDS,
    );
    const plan = planRows(contactCandidates(t, mapping), [
      { label: "Kundennummer", value: "k-7" },
      { label: "E-Mail", value: "info@bestand.example" },
    ]);
    expect(plan.map((r) => [r.status, r.message])).toEqual([
      ["neu", null],
      ["dublette", "Gibt es schon (Kundennummer k-7)"],
      ["dublette", "Gibt es schon (E-Mail info@bestand.example)"],
      ["dublette", "Wie Zeile 2 (Name neu gmbh)"],
      ["neu", null],
    ]);
    expect(planCounts(plan)).toEqual({ neu: 2, dublette: 3, fehler: 0 });
  });
});

describe("Artikel", () => {
  it("übernimmt Nettopreis, Einheit und Steuersatz; Bruttopreis nur ohne Nettopreis", () => {
    const { t, mapping } = mapped(
      [
        "Artikelnummer;Bezeichnung;Beschreibung;Einheit;Nettopreis;Bruttopreis;Umsatzsteuer",
        'A-1;Beratung;"Vor Ort,\nmit Anfahrt";Stunde;95,00;113,05;19',
        "A-2;Fachbuch;;Stück;;29,90;7 %",
      ].join("\n"),
      ARTICLE_FIELDS,
    );
    const rows = articleCandidates(t, mapping);
    expect(rows[0]!.value).toEqual({
      number: "A-1",
      description: "Beratung",
      detail: "Vor Ort,\nmit Anfahrt",
      unit: "Std.",
      unitPrice: 9500,
      taxRate: 1900,
      priceIncludesTax: false,
      note: "",
    });
    expect(rows[1]!.value).toMatchObject({ unit: "Stk.", unitPrice: 2990, taxRate: 700, priceIncludesTax: true });
  });

  it("liest die Steuerart der Mustervorlage von Lexware Office (USt 19%)", () => {
    // Werte „USt 19%“, „USt 7%“, „USt 0%“: https://help.lexware.de/de-form/articles/625906-fehlercodes-beim-artikel-import-csv-beheben
    const { t, mapping } = mapped(
      "Bezeichnung;Einheit;Steuerart;Nettopreis\nBeratung;Stunde;USt 19%;95,00\nBuch;Stück;USt 7%;10,00\nAusland;Stück;USt 0%;10,00\n",
      ARTICLE_FIELDS,
    );
    const rows = articleCandidates(t, mapping);
    expect(rows.map((r) => r.errors)).toEqual([[], [], []]);
    expect(rows.map((r) => r.value?.taxRate)).toEqual([1900, 700, 0]);
  });

  it("meldet fehlenden Steuersatz, fehlenden Preis und Netto/Brutto, die nicht zusammenpassen", () => {
    const { t, mapping } = mapped("Bezeichnung;Nettopreis;Bruttopreis;Steuersatz\nA;10,00;;\nB;;;19\nC;100,00;100,00;19\nD;1,234.00;;19\n", ARTICLE_FIELDS);
    expect(articleCandidates(t, mapping).map((r) => r.errors)).toEqual([
      ["Steuersatz fehlt"],
      ["Preis fehlt (Netto- oder Bruttopreis)"],
      ["Nettopreis 100,00 und Bruttopreis 100,00 passen nicht zum Steuersatz"],
      ["Nettopreis: „1,234.00“ ist kein Betrag wie 1.234,56"],
    ]);
  });

  it("erkennt Dubletten an der Artikelnummer, ohne Nummer an der Bezeichnung", () => {
    const { t, mapping } = mapped(
      "Artikelnummer;Bezeichnung;Nettopreis;Steuersatz\nA-1;Beratung;1;19\n;beratung;1;19\n;Beratung;1;19\na-1;Anders;1;19\n",
      ARTICLE_FIELDS,
    );
    const plan = planRows(articleCandidates(t, mapping), [{ label: "Bezeichnung", value: "beratung" }]);
    expect(plan.map((r) => r.status)).toEqual(["neu", "dublette", "dublette", "dublette"]);
  });
});

describe("Anlagen", () => {
  const STICHTAG = "2026-01-01";
  const assets = (text: string) => {
    const { t, mapping } = mapped(text, ASSET_FIELDS);
    return assetCandidates(t, mapping, STICHTAG);
  };
  const HEAD = "Bezeichnung;Art;Abschreibung;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert;bisherige AfA";

  it("übernimmt eine Anlage mit Restbuchwert zum Stichtag, wie „Anlage übernehmen“", () => {
    const [row] = assets(`${HEAD}\nPkw;Fahrzeug;linear;15.03.2024;36.000,00;6;25.000,00;\n`);
    expect(row!.errors).toEqual([]);
    expect(row!.value).toEqual({
      name: "Pkw",
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2024-03-15",
      cost: 3600000,
      usefulLifeMonths: 72,
      degressiveRate: null,
      openingDate: STICHTAG,
      openingBookValue: 2500000,
      note: "",
    });
  });

  it("übernimmt degressive und Elektro-AfA nur mit dem rechnerischen Restbuchwert zum 01.01.", () => {
    const rows = assets(
      [
        `${HEAD};Degressiver Satz`,
        // April 2024, 10 Jahre, 20 %: 2024 9/12 von 10.000 €, 2025 8.500 €, Rest 34.000 €
        "Maschine;Sonstiges;degressiv;10.04.2024;50.000,00;10;34.000,00;;",
        // Satz angegeben, aber Restbuchwert passt zum Höchstsatz, nicht zu 15 %
        "Presse;Sonstiges;degressiv;10.04.2024;50.000,00;10;34.000,00;;15",
        "Tesla;Fahrzeug;Elektro § 7 Abs. 2a;03.11.2025;60.000,00;;15.000,00;;",
        "E-Auto falsch;Fahrzeug;Elektro;03.11.2025;60.000,00;;20.000,00;;",
        "Degressiv alt;;degressiv;01.02.2023;900,00;5;500,00;;",
      ].join("\n"),
    );
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.value).toMatchObject({ method: "degressiv", usefulLifeMonths: 120, degressiveRate: null, openingBookValue: 3_400_000 });
    expect(rows[1]!.errors).toEqual([expect.stringContaining("Restbuchwert passt nicht zur degressiven AfA")]);
    expect(rows[2]!.errors).toEqual([]);
    expect(rows[2]!.value).toMatchObject({ kind: "kfz", method: "elektro", usefulLifeMonths: null });
    expect(rows[3]!.errors).toEqual(["Restbuchwert passt nicht zur AfA nach § 7 Abs. 2a EStG (rechnerisch 15.000,00 €); dann linear übernehmen"]);
    expect(rows[4]!.errors).toEqual([expect.stringContaining("Degressive AfA nur bei Anschaffung vom 01.01.2020 bis 31.12.2022")]);
  });

  it("rechnet den Restbuchwert aus der bisherigen AfA; beide angegeben müssen zusammenpassen", () => {
    const rows = assets(`${HEAD}\nSchreibtisch;Büromöbel;;01.07.2023;1.300,00;13;;250,00\nRegal;Büro;;01.07.2023;1.300,00;13;1.000,00;250,00\n`);
    expect(rows[0]!.value).toMatchObject({ kind: "buero", method: "linear", usefulLifeMonths: 156, openingBookValue: 105000 });
    expect(rows[1]!.errors).toEqual(["Restbuchwert und bisherige AfA ergeben zusammen nicht die Anschaffungskosten"]);
  });

  it("nimmt die Nutzungsdauer auch in Monaten oder als Bruchteil von Jahren", () => {
    const rows = assets("Bezeichnung;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer (Monate);Restbuchwert\nMaschine;01.01.2024;10.000,00;30;2.000,00\n");
    expect(rows[0]!.value?.usefulLifeMonths).toBe(30);
    const years = assets(
      "Bezeichnung;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert\nMaschine;01.01.2024;10.000,00;2,5;2.000,00\nX;01.01.2024;10.000,00;2,3;2.000,00\n",
    );
    expect(years[0]!.value?.usefulLifeMonths).toBe(30);
    expect(years[1]!.errors).toEqual(["Nutzungsdauer: „2,3“ Jahre ergibt keine ganzen Monate"]);
  });

  it("lehnt ab, was keine Übernahme ist oder im Stichtagsjahr falsch abgeschrieben würde", () => {
    const rows = assets(
      [
        HEAD,
        // Anschaffung am Stichtag: Zugang per Beleg
        "Neuer Laptop;Computer;;01.01.2026;1.500,00;;1.500,00;",
        // Computer mit einjähriger Nutzungsdauer: im Anschaffungsjahr voll abgeschrieben
        "Alter Laptop;Computer;;10.05.2025;1.500,00;;1.500,00;",
        // Nutzungsdauer seit 2025 abgelaufen, trotzdem Restbuchwert
        "Altauto;Fahrzeug;;01.01.2019;20.000,00;6;100,00;",
        "Stuhl;Büro;GWG;01.02.2024;500,00;;100,00;",
        "Sammel;;Sammelposten;01.02.2020;900,00;;180,00;",
        "Zu viel;;linear;01.02.2024;900,00;5;1.000,00;",
        "Degressiv;;degressiv;01.02.2024;900,00;5;500,00;",
        "Ohne ND;Sonstiges;;01.02.2024;900,00;;500,00;",
      ].join("\n"),
    );
    expect(rows.map((r) => r.errors)).toEqual([
      ["Angeschafft am oder nach dem Stichtag: keine Übernahme, sondern als Beleg mit der Kategorie Anlagegut buchen"],
      ["Im Anschaffungsjahr voll abgeschrieben; der Restbuchwert muss 0 sein"],
      ["Nutzungsdauer am Stichtag abgelaufen; der Restbuchwert muss 0 sein"],
      ["Im Anschaffungsjahr voll abgeschrieben; der Restbuchwert muss 0 sein"],
      ["Sammelposten nach fünf Jahren aufgelöst; der Restbuchwert muss 0 sein"],
      ["Restbuchwert muss zwischen 0 und den Anschaffungskosten liegen"],
      [expect.stringContaining("Degressive AfA nur bei Anschaffung")],
      ["Nutzungsdauer fehlt"],
    ]);
  });

  it("meldet fehlende Pflichtangaben einzeln", () => {
    const [row] = assets(`${HEAD}\n;Raumschiff;;15.03.24;;;;\n`);
    expect(row!.errors).toEqual([
      "Bezeichnung fehlt",
      expect.stringContaining("Art: „Raumschiff“"),
      "Anschaffungsdatum: „15.03.24“ ist kein Datum wie 31.12.2025",
      "Anschaffungskosten fehlen",
    ]);
  });

  it("erkennt eine Anlage an Bezeichnung, Anschaffung und Kosten wieder", () => {
    const rows = assets(
      `${HEAD}\nPkw;Fahrzeug;;15.03.2024;36.000,00;6;25.000,00;\nPkw;Fahrzeug;;15.03.2024;36.000,00;6;25.000,00;\nPkw;Fahrzeug;;15.03.2025;36.000,00;6;30.000,00;\n`,
    );
    expect(planRows(rows, []).map((r) => [r.status, r.message])).toEqual([
      ["neu", null],
      ["dublette", "Wie Zeile 2 (Bezeichnung, Anschaffung und Kosten pkw · 15.03.2024 · 36.000,00 €)"],
      ["neu", null],
    ]);
  });
});
