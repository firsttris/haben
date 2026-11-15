import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Kontakte aus DATEV-Stammdaten „Debitoren/Kreditoren“ über den CSV-Import (#472). Kopf und Spalten wie im Export von
 * sevDesk, die Zeilen erfunden. Was ohne Datenbank geht (Spalten, Zusammenführen, Konflikte), prüfen
 * packages/import/src/datev-stammdaten.test.ts und csv-import/datev-kontakte.test.ts; hier Bestand, Bestätigung und Sperren.
 */

const COLUMNS = readFileSync(new URL("../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/extf-gp-stamm.csv", import.meta.url), "utf-8")
  .split(/\r?\n/)[1]!
  .split(";");
const HEADER = `"EXTF";700;16;"Debitoren/Kreditoren";5;;;;;;1;1;20240101;4;;;;;;;;;;;;;;;;;`;
const row = (values: Record<string, string>) => COLUMNS.map((name) => values[name] ?? "").join(";");
const gpStamm = (...rows: Record<string, string>[]) => new TextEncoder().encode([HEADER, COLUMNS.join(";"), ...rows.map(row)].join("\r\n"));
const firma = (konto: string, name: string, extra: Record<string, string> = {}) => ({
  Konto: konto,
  "Name (Adressatentyp Unternehmen)": name,
  Adressatentyp: "2",
  ...extra,
});
const ust = (nummer: string) => ({ "EU-Mitgliedstaat": "DE", "EU-UStId.": nummer });

describe.skipIf(!testDatabaseUrl)("CSV-Import: Kontakte aus DATEV-Stammdaten (Postgres)", () => {
  let csv: typeof import("./csv-import.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const options = (extra: Record<string, unknown> = {}) => csv.csvImportOptionsSchema.parse({ kind: "kontakte", ...extra });

  beforeAll(async () => {
    sql = await setupTestDb();
    csv = await import("./csv-import.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate datev_personenkonten, contacts, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland, customer_number_format, customer_number_next)
      values (1, 'Testfirma', 'ist', 'SKR04', 'BY', 'K-{n}', 1)`;
  });

  const DATEI = gpStamm(
    firma("10001", "Müller & Söhne GmbH", {
      ...ust("136695976"),
      Straße: "Hauptstraße 5",
      Postleitzahl: "50667",
      Ort: "Köln",
      Land: "DE",
      Kundennummer: "K-100",
    }),
    firma("70001", "Müller & Söhne GmbH Einkauf", { ...ust("136695976"), "IBAN-Nr. 1": "DE89 3704 0044 0532 0130 00" }),
    firma("70002", "Müller & Söhne GmbH"),
  );

  it("führt Debitor und Kreditor mit gleicher USt-IdNr. zusammen, gleicher Name allein nicht; ein zweiter Import ändert nichts", async () => {
    const preview = await csv.previewCsvImport(DATEI, options());
    expect(preview).toMatchObject({ source: "datev", encoding: "UTF-8", problem: null, counts: { neu: 2, zuordnen: 0, dublette: 0, fehler: 0 } });
    expect(preview.rows.map((r) => [r.lines, r.status, r.message])).toEqual([
      [[3, 4], "neu", "Debitor 10001 und Kreditor 70001: gleiche USt-IdNr. DE136695976; Name in Zeile 4: „Müller & Söhne GmbH Einkauf“"],
      [[5], "neu", "Gleicher Name wie Zeile 3; ohne gleiche USt-IdNr. oder Steuernummer ein eigener Kontakt"],
    ]);
    expect(await csv.runCsvImport(actor, DATEI, options())).toEqual({ created: 2, assigned: 0, duplicates: 0, failed: 0, unconfirmed: 0 });
    const contacts =
      await sql`select name, kundennummer, debitor_nr, kreditor_nr, is_customer, is_supplier, ust_id, iban, strasse, version from contacts order by kreditor_nr`;
    expect(contacts.map((c) => ({ ...c }))).toEqual([
      {
        name: "Müller & Söhne GmbH",
        kundennummer: "K-100",
        debitor_nr: 10001,
        kreditor_nr: 70001,
        is_customer: true,
        is_supplier: true,
        ust_id: "DE136695976",
        iban: "DE89370400440532013000",
        strasse: "Hauptstraße 5",
        version: 1,
      },
      {
        name: "Müller & Söhne GmbH",
        kundennummer: null,
        debitor_nr: null,
        kreditor_nr: 70002,
        is_customer: false,
        is_supplier: true,
        ust_id: "",
        iban: "",
        strasse: "",
        version: 1,
      },
    ]);
    const audit = await sql`select distinct actor from audit_log where table_name = 'contacts' and action = 'INSERT'`;
    expect(audit.map((a) => a.actor)).toEqual([actor]);

    const again = await csv.previewCsvImport(DATEI, options());
    expect(again.rows.map((r) => [r.lines, r.status, r.message])).toEqual([
      [[3, 4], "dublette", "Gibt es schon („Müller & Söhne GmbH“, Debitor 10001 und Kreditor 70001)"],
      [[5], "dublette", "Gibt es schon („Müller & Söhne GmbH“, Kreditor 70002)"],
    ]);
    await expect(csv.runCsvImport(actor, DATEI, options())).rejects.toThrow("Nichts zu übernehmen");
    const after = await sql`select count(*)::int as n, max(version) as v from contacts`;
    expect({ ...after[0] }).toEqual({ n: 2, v: 1 });
  });

  it("macht eine Nummer, die schon an einem anderen Kontakt hängt, zur Fehlerzeile und übernimmt den Rest", async () => {
    await sql`insert into contacts (name, land, ust_id, kreditor_nr, is_customer, is_supplier) values ('Papierwerk Süd AG', 'DE', 'DE111111125', 70001, false, true)`;
    const preview = await csv.previewCsvImport(DATEI, options());
    expect(preview.rows.map((r) => [r.lines, r.status, r.message])).toEqual([
      [[3, 4], "fehler", "Kreditor 70001 hat schon „Papierwerk Süd AG“ mit anderer USt-IdNr. (DE111111125)"],
      [[5], "neu", "Gleicher Name wie Zeile 3; ohne gleiche USt-IdNr. oder Steuernummer ein eigener Kontakt"],
    ]);
    expect(await csv.runCsvImport(actor, DATEI, options())).toMatchObject({ created: 1, failed: 1 });
    const [papier] = await sql`select name, kreditor_nr, debitor_nr from contacts where ust_id = 'DE111111125'`;
    expect({ ...papier }).toEqual({ name: "Papierwerk Süd AG", kreditor_nr: 70001, debitor_nr: null });
  });

  it("lässt eine schon exportierte Nummer fest: keine andere Nummer am Kontakt, Fehlerzeile in der Vorschau", async () => {
    const [bestand] = await sql`insert into contacts (name, land, ust_id, debitor_nr) values ('Müller GmbH', 'DE', 'DE136695976', 10005) returning id`;
    await sql`insert into datev_personenkonten (contact_id, rolle, nummer, jahr) values (${bestand!.id}, 'debitor', 10005, 2025)`;
    const datei = gpStamm(firma("10001", "Müller & Söhne GmbH", ust("136695976")), firma("10002", "Neu GmbH"));
    const preview = await csv.previewCsvImport(datei, options());
    expect(preview.rows.map((r) => [r.line, r.status, r.message])).toEqual([
      [3, "fehler", "„Müller GmbH“ mit gleicher USt-IdNr. hat schon Debitor 10005; er steht in einem DATEV-Export und bleibt fest"],
      [4, "neu", null],
    ]);
    // Auch eine Bestätigung der Zeile ändert nichts: bestätigt werden nur Vorschläge
    expect(await csv.runCsvImport(actor, datei, options({ confirm: [3] }))).toMatchObject({ created: 1, assigned: 0, failed: 1 });
    const [nachher] = await sql`select debitor_nr, version from contacts where id = ${bestand!.id}`;
    expect({ ...nachher }).toEqual({ debitor_nr: 10005, version: 1 });
  });

  it("vergibt die Nummer an einen vorhandenen Kontakt mit gleicher USt-IdNr. nur nach Bestätigung", async () => {
    const [bestand] =
      await sql`insert into contacts (name, land, ust_id, is_customer, is_supplier) values ('Müller GmbH', 'DE', 'DE136695976', false, true) returning id`;
    const datei = gpStamm(firma("10001", "Müller & Söhne GmbH", ust("136695976")));
    const preview = await csv.previewCsvImport(datei, options());
    expect(preview.counts).toEqual({ neu: 0, zuordnen: 1, dublette: 0, fehler: 0 });
    expect(preview.rows).toEqual([
      { line: 3, lines: [3], title: "Müller & Söhne GmbH", status: "zuordnen", message: "Debitor 10001 an „Müller GmbH“ vergeben (gleiche USt-IdNr.)" },
    ]);
    // Ohne Bestätigung legt der Import weder einen zweiten Kontakt an noch vergibt er die Nummer
    await expect(csv.runCsvImport(actor, datei, options())).rejects.toThrow("Nichts zu übernehmen");
    expect(await csv.runCsvImport(actor, datei, options({ confirm: [3] }))).toEqual({ created: 0, assigned: 1, duplicates: 0, failed: 0, unconfirmed: 0 });
    const contacts = await sql`select id, name, debitor_nr, is_customer, is_supplier, version from contacts`;
    expect(contacts.map((c) => ({ ...c }))).toEqual([
      { id: bestand!.id, name: "Müller GmbH", debitor_nr: 10001, is_customer: true, is_supplier: true, version: 2 },
    ]);
    const versions = await sql`select version from contact_versions where contact_id = ${bestand!.id} order by version`;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await csv.previewCsvImport(datei, options())).rows.map((r) => r.status)).toEqual(["dublette"]);
  });

  it("lehnt einen GP-Stamm unter Artikeln ab und nennt den Grund einer anderen Sachkontenlänge", async () => {
    await expect(csv.previewCsvImport(DATEI, csv.csvImportOptionsSchema.parse({ kind: "artikel" }))).rejects.toThrow("gehört zu den Kontakten");
    const fuenf = new TextEncoder().encode(new TextDecoder().decode(DATEI).replace(";20240101;4;", ";20240101;5;"));
    await expect(csv.previewCsvImport(fuenf, options())).rejects.toThrow("Sachkontenlänge 5");
  });
});
