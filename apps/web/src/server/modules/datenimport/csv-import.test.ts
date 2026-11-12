import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("CSV-Import (Postgres)", () => {
  let csv: typeof import("./csv-import.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const bytes = (text: string) => new TextEncoder().encode(text);
  const options = (kind: "kontakte" | "artikel" | "anlagen", extra: Record<string, unknown> = {}) => csv.csvImportOptionsSchema.parse({ kind, ...extra });

  beforeAll(async () => {
    sql = await setupTestDb();
    csv = await import("./csv-import.ts");
    assets = await import("../buchhaltung/assets.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll" = "ist") {
    await leeren(sql)`truncate asset_depreciations, assets, journal_lines, journal_entries, year_closings, contacts, articles, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland, customer_number_format, customer_number_next)
      values (1, 'Testfirma', ${versteuerung}, ${kontenrahmen}, 'BY', 'K-{n}', 1)`;
  }

  beforeEach(() => company("SKR03"));

  const KONTAKTE = [
    "Kundennummer;Lieferantennummer;Firmenname;Vorname;Nachname;Straße;PLZ;Ort;Land;E-Mail;USt-IdNr.;IBAN",
    "10001;;Müller & Söhne GmbH;;;Hauptstraße 5;50667;Köln;DE;rechnung@mueller.example;DE136695976;DE89 3704 0044 0532 0130 00",
    ";;;Erika;Mustermann;Lindenweg 2;80331;München;;erika@mustermann.example, chef@mustermann.example;;",
    ";70001;Papierwerk Süd AG;;;Industriestr. 9;70173;Stuttgart;276;buchhaltung@papierwerk.example;;",
    "10004;;Kaputt GmbH;;;;;;;keine-adresse;;",
    "10005;;Doppelt GmbH;;;;;;;RECHNUNG@mueller.example;;",
  ].join("\r\n");

  it("Kontakte: Vorschau mit Vorschlag der Spalten, Fehlern und Dubletten; Import legt nur neue an, mit Kundennummer und Audit", async () => {
    await sql`insert into contacts (name, land, kundennummer, email) values ('Bestand KG', 'DE', '10001', 'alt@bestand.example')`;
    const preview = await csv.previewCsvImport(bytes(KONTAKTE), options("kontakte"));
    expect(preview).toMatchObject({ encoding: "UTF-8", delimiter: "Semikolon", problem: null, counts: { neu: 3, dublette: 1, fehler: 1 } });
    expect(preview.mapping).toMatchObject({ kundennummer: 0, lieferantennummer: 1, firma: 2, vorname: 3, nachname: 4, iban: 11, rolle: null });
    expect(preview.rows.map((r) => [r.line, r.status, r.message])).toEqual([
      [2, "dublette", "Gibt es schon (Kundennummer 10001)"],
      [3, "neu", null],
      [4, "neu", null],
      [5, "fehler", "E-Mail: Keine gültige E-Mail-Adresse"],
      // Zeile 2 wird nicht übernommen, ihre E-Mail zählt deshalb nicht als schon in der Datei
      [6, "neu", null],
    ]);
  });

  it("Kontakte: E-Mail der Datei gegen den Bestand, Kundennummer automatisch nur für Kunden", async () => {
    await sql`insert into contacts (name, land, email) values ('Bestand KG', 'DE', 'rechnung@mueller.example')`;
    const result = await csv.runCsvImport(actor, bytes(KONTAKTE), options("kontakte"));
    expect(result).toEqual({ created: 2, duplicates: 2, failed: 1 });
    const rows = await sql`select name, kundennummer, lieferantennummer, is_customer, is_supplier, email, land, iban, ust_id from contacts order by name`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      expect.objectContaining({ name: "Bestand KG" }),
      {
        name: "Erika Mustermann",
        kundennummer: "K-1",
        lieferantennummer: null,
        is_customer: true,
        is_supplier: false,
        email: "erika@mustermann.example, chef@mustermann.example",
        land: "DE",
        iban: "",
        ust_id: "",
      },
      {
        name: "Papierwerk Süd AG",
        kundennummer: null,
        lieferantennummer: "70001",
        is_customer: false,
        is_supplier: true,
        email: "buchhaltung@papierwerk.example",
        land: "DE",
        iban: "",
        ust_id: "",
      },
    ]);
    const audit = await sql`select distinct actor from audit_log where table_name = 'contacts' and action = 'INSERT' and actor is not null`;
    expect(audit.map((a) => a.actor)).toEqual([actor]);
    // Ein zweiter Lauf mit derselben Datei legt nichts mehr an
    await expect(csv.runCsvImport(actor, bytes(KONTAKTE), options("kontakte"))).rejects.toThrow("Nichts zu übernehmen");
  });

  it("Kontakte: eine automatische Kundennummer nimmt keine Nummer, die weiter unten in derselben Datei steht", async () => {
    const file = "Kundennummer;Firmenname\n;Ohne Nummer GmbH\nK-1;Mit Nummer GmbH\n";
    expect(await csv.runCsvImport(actor, bytes(file), options("kontakte"))).toEqual({ created: 2, duplicates: 0, failed: 0 });
    const rows = await sql`select name, kundennummer from contacts order by name`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { name: "Mit Nummer GmbH", kundennummer: "K-1" },
      { name: "Ohne Nummer GmbH", kundennummer: "K-2" },
    ]);
  });

  it("legt alle Zeilen in einer Transaktion an: scheitert eine in der Datenbank, bleibt keine", async () => {
    await sql`alter table articles add constraint test_kein_kaputt check (description <> 'Kaputt')`;
    try {
      const file = "Artikelnummer;Bezeichnung;Nettopreis;Steuersatz\nA-1;Beratung;95,00;19\nA-2;Kaputt;1,00;19\n";
      await expect(csv.runCsvImport(actor, bytes(file), options("artikel"))).rejects.toThrow();
      expect(await sql`select id from articles`).toHaveLength(0);
    } finally {
      await sql`alter table articles drop constraint test_kein_kaputt`;
    }
  });

  it("Kontakte: übernimmt DATEV-Debitor und -Kreditor und zeigt eine schon vergebene Nummer als Konflikt (#327)", async () => {
    await sql`insert into contacts (name, land, debitor_nr) values ('Bestand KG', 'DE', 10042)`;
    const datei = ["Kundennummer;Debitorennummer;Kreditorennummer;Firmenname", "K-42;10043;70087;Musterpartner GmbH", ";10042;;Zweiter Name GmbH"].join("\r\n");
    const preview = await csv.previewCsvImport(bytes(datei), options("kontakte"));
    expect(preview.rows.map((r) => [r.line, r.status, r.message])).toEqual([
      [2, "neu", null],
      [3, "dublette", "Gibt es schon (Debitor 10042)"],
    ]);
    expect(await csv.runCsvImport(actor, bytes(datei), options("kontakte"))).toEqual({ created: 1, duplicates: 1, failed: 0 });
    const [partner] = await sql`select kundennummer, debitor_nr, kreditor_nr, is_customer, is_supplier from contacts where name = 'Musterpartner GmbH'`;
    expect({ ...partner }).toEqual({ kundennummer: "K-42", debitor_nr: 10043, kreditor_nr: 70087, is_customer: true, is_supplier: true });
  });

  it("Artikel: Windows-1252 mit Tabulator, eigene Zuordnung, Dubletten nach Artikelnummer", async () => {
    await sql`insert into articles (number, description, unit, unit_price, tax_rate) values ('A-1', 'Alt', 'Std.', 100, 1900)`;
    // Ü ist in Windows-1252 das Byte 0xDC, wie in Latin-1
    const file = Uint8Array.from("Nr\tText\tPreis\tUSt\tEinheit\nA-1\tBeratung\t95,00\t19\tStunde\nA-2\tÜbersetzung\t1.200,00\t7\tPauschal\n", (c) =>
      c.charCodeAt(0),
    );
    const auto = await csv.previewCsvImport(file, options("artikel"));
    expect(auto).toMatchObject({ encoding: "Windows-1252", delimiter: "Tabulator", mapping: { number: null, description: null, unit: 4 } });
    const mapping = { number: 0, description: 1, netPrice: 2, taxRate: 3, unit: 4 };
    expect(await csv.runCsvImport(actor, file, options("artikel", { mapping }))).toEqual({ created: 1, duplicates: 1, failed: 0 });
    const [row] = await sql`select description, unit, unit_price, tax_rate, price_includes_tax from articles where number = 'A-2'`;
    expect({ ...row }).toEqual({ description: "Übersetzung", unit: "Psch.", unit_price: 120000, tax_rate: 700, price_includes_tax: false });
    await expect(csv.previewCsvImport(file, options("artikel", { mapping: { number: 0, description: 0 } }))).rejects.toThrow(/Artikelnummer und Bezeichnung/);
  });

  it("Artikel: eine Zeile ohne Nummer ist Dublette eines gleichnamigen Artikels mit Nummer; mit anderer Nummer nicht", async () => {
    await sql`insert into articles (number, description, unit, unit_price, tax_rate) values ('A-1', 'Beratung', 'Std.', 100, 1900)`;
    const file = "Artikelnummer;Bezeichnung;Nettopreis;Steuersatz\n;beratung;95,00;19\nB-2;Beratung;95,00;19\n";
    const preview = await csv.previewCsvImport(bytes(file), options("artikel"));
    expect(preview.rows.map((r) => [r.status, r.message])).toEqual([
      ["dublette", "Gibt es schon (Bezeichnung beratung)"],
      ["neu", null],
    ]);
  });

  const ANLAGEN = [
    "Bezeichnung;Art;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert",
    "Pkw;Fahrzeug;15.03.2024;36.000,00;6;25.000,00",
    "Schreibtisch;Büromöbel;01.07.2023;1.300,00;13;1.050,00",
    "Laptop neu;Computer;10.01.2026;1.500,00;;1.500,00",
  ].join("\n");

  for (const [kontenrahmen, versteuerung, konto, vortrag] of [
    ["SKR03", "ist", "0320", "9000"],
    ["SKR04", "soll", "0520", "9000"],
  ] as const) {
    it(`Anlagen (${kontenrahmen}, ${versteuerung}): Übernahme zum Stichtag ohne Buchung; die Eröffnung entsteht erst mit der AfA`, async () => {
      await company(kontenrahmen, versteuerung);
      const stichtag = { stichtag: "2026-01-01" };
      const preview = await csv.previewCsvImport(bytes(ANLAGEN), options("anlagen", stichtag));
      expect(preview.counts).toEqual({ neu: 2, dublette: 0, fehler: 1 });
      expect(preview.rows[2]!.message).toMatch(/als Beleg mit der Kategorie Anlagegut buchen/);
      expect(await csv.runCsvImport(actor, bytes(ANLAGEN), options("anlagen", stichtag))).toEqual({ created: 2, duplicates: 0, failed: 1 });

      const [pkw] = await sql`select id, account, opening_date::text as opening, opening_book_value, opening_entry_id from assets where name = 'Pkw'`;
      expect({ ...pkw, id: undefined }).toEqual({
        id: undefined,
        account: konto,
        opening: "2026-01-01",
        opening_book_value: 2_500_000,
        opening_entry_id: null,
      });
      expect(await sql`select id from journal_entries`).toHaveLength(0);

      // Wie bei „Anlage übernehmen“: erst die AfA bucht die Eröffnung gegen den Saldenvortrag
      await assets.bookDepreciation(actor, 2026, "2026-12-01");
      const opening = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_id = ${pkw!.id} and e.date = '2026-01-01' order by l.debit desc`;
      expect(opening.map((r) => ({ ...r }))).toEqual([
        { account: konto, debit: 2_500_000, credit: 0 },
        { account: vortrag, debit: 0, credit: 2_500_000 },
      ]);

      // Nach gebuchter AfA 2026 kein Stichtag mehr in 2026: das änderte ein gebuchtes Jahr
      const later = await csv.previewCsvImport(bytes(ANLAGEN.replace("Pkw", "Pkw 2")), options("anlagen", stichtag));
      expect(later.problem).toBe("Für 2026 ist die AfA schon gebucht; der Übernahmestichtag muss danach liegen, frühestens am 01.01.2027.");
      await expect(csv.runCsvImport(actor, bytes(ANLAGEN.replace("Pkw", "Pkw 2")), options("anlagen", stichtag))).rejects.toThrow("AfA schon gebucht");
    });
  }

  it("Anlagen der GmbH: die Vorschau lehnt die Staffel nach § 7 Abs. 2a EStG ab, nicht erst der Import", async () => {
    await sql`update company set rechtsform = 'gmbh'`;
    const file = [
      "Bezeichnung;Art;Abschreibung;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert",
      "E-Transporter;Fahrzeug;Elektro;01.08.2025;40.000,00;;10.000,00",
      "Drehbank;Sonstige;degressiv;10.04.2024;50.000,00;10;34.000,00",
    ].join("\n");
    const preview = await csv.previewCsvImport(bytes(file), options("anlagen", { stichtag: "2026-01-01" }));
    expect(preview.counts).toEqual({ neu: 1, dublette: 0, fehler: 1 });
    expect(preview.rows[0]!.message).toMatch(/§ 7 Abs. 2a EStG nur im Einzelunternehmen/);
  });

  it("Anlagen: kein Stichtag in einem abgeschlossenen Jahr, Stichtag ist Pflicht", async () => {
    await sql`insert into year_closings (year) values (2025)`;
    const preview = await csv.previewCsvImport(bytes(ANLAGEN), options("anlagen", { stichtag: "2025-06-01" }));
    expect(preview.problem).toBe("Das Jahr 2025 ist abgeschlossen; der Übernahmestichtag muss danach liegen.");
    await expect(csv.previewCsvImport(bytes(ANLAGEN), options("anlagen"))).rejects.toThrow("Übernahmestichtag");
  });
});
