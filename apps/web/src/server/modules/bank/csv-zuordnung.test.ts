import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Erfundene Bank mit Kopfblock, Soll und Haben (packages/import/test-fixtures) */
const fixture = new Uint8Array(readFileSync(new URL("../../../../../../packages/import/test-fixtures/unbekannte-bank-soll-haben.csv", import.meta.url)));
const file = { bytes: fixture, filename: "umsaetze.csv" };
const withoutMapping = { accountId: null, headerRow: null, mapping: null };

describe.skipIf(!testDatabaseUrl)("Bank-CSV mit eigener Spaltenzuordnung (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let zuordnung: typeof import("./csv-zuordnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    zuordnung = await import("./csv-zuordnung.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts cascade`;
  });

  const account = (name = "Geschäftskonto", iban = "DE89370400440532013000") => bank.createAccount(actor, { name, iban });

  it("bietet die Zuordnung an, importiert mit ihr und liest den nächsten Export ohne Rückfrage", async () => {
    const konto = await account();
    await expect(zuordnung.importStatementFile(actor, file, konto.id)).rejects.toThrow(zuordnung.UnbekannteCsvError);
    // Ohne Konto ebenso: das Konto wählt man in der Zuordnung
    await expect(zuordnung.importStatementFile(actor, file, null)).rejects.toThrow(zuordnung.UnbekannteCsvError);

    const vorschau = await zuordnung.previewCsvZuordnung(file.bytes, file.filename, { ...withoutMapping, accountId: konto.id });
    expect(vorschau).toMatchObject({ saved: false, problem: null, counts: { ok: 4, fehler: 1 }, encoding: "windows-1252", delimiter: ";" });
    expect(vorschau.headerChoices[vorschau.headerRow]!.line).toBe(4);
    // Fehler zuerst: der Kontostand am Ende ist kein Umsatz
    expect(vorschau.rows[0]).toMatchObject({ line: 9, amount: null });

    const result = await zuordnung.importCsvZuordnung(actor, file, { accountId: konto.id, headerRow: vorschau.headerRow, mapping: vorschau.mapping });
    expect(result).toMatchObject({ accountId: konto.id, added: 4, skipped: 0 });
    expect(result.warnings).toEqual([expect.stringMatching(/^Zeile 9 nicht übernommen/)]);

    const [imported] = await sql`select format, csv_mapping from bank_imports`;
    expect(imported).toMatchObject({ format: "csv-zuordnung", csv_mapping: vorschau.mapping });
    const [gespeichert] = await sql`select csv_mapping from bank_accounts where id = ${konto.id}`;
    expect(gespeichert!.csv_mapping).toEqual(vorschau.mapping);
    const audit = await sql`select actor from audit_log where table_name = 'bank_accounts' and action = 'UPDATE' and new_value ? 'csv_mapping'`;
    expect(audit.map((a) => a.actor)).toEqual([actor]);
    expect((await sql`select amount from bank_transactions order by booking_date`).map((t) => t.amount)).toEqual([1085280, -119000, -3999, -990]);

    // Derselbe Export noch einmal: ohne Rückfrage, und keine Dubletten
    expect(await zuordnung.importStatementFile(actor, { ...file, filename: "umsaetze-2.csv" }, konto.id)).toMatchObject({ added: 0, skipped: 4 });
    const vorschauDanach = await zuordnung.previewCsvZuordnung(file.bytes, file.filename, { ...withoutMapping, accountId: konto.id });
    expect(vorschauDanach).toMatchObject({ saved: true, mapping: vorschau.mapping });
  });

  it("nimmt die Zuordnung eines Kontos nicht für ein anderes und nicht für eine andere Kopfzeile", async () => {
    const konto = await account();
    const anderes = await account("Rücklage", "DE02120300000000202051");
    const v = await zuordnung.previewCsvZuordnung(file.bytes, file.filename, { ...withoutMapping, accountId: konto.id });
    await zuordnung.importCsvZuordnung(actor, file, { accountId: konto.id, headerRow: v.headerRow, mapping: v.mapping });

    await expect(zuordnung.importStatementFile(actor, file, anderes.id)).rejects.toThrow(zuordnung.UnbekannteCsvError);
    const andereKopfzeile = new TextEncoder().encode("Datum;Betrag;Zweck\n01.11.2026;-5,00;Test\n");
    await expect(zuordnung.importStatementFile(actor, { bytes: andereKopfzeile, filename: "x.csv" }, konto.id)).rejects.toThrow(zuordnung.UnbekannteCsvError);
    expect((await sql`select count(*)::int as n from bank_transactions where bank_account_id = ${anderes.id}`)[0]!.n).toBe(0);
  });

  it("verlangt ein Konto und lehnt den Zahlungsdienstleister ab", async () => {
    const v = await zuordnung.previewCsvZuordnung(file.bytes, file.filename, withoutMapping);
    await expect(zuordnung.importCsvZuordnung(actor, file, { accountId: null, headerRow: v.headerRow, mapping: v.mapping })).rejects.toThrow(
      "Wähle das Konto, zu dem die Datei gehört.",
    );
    const paypal = await bank.createProviderAccount(actor, { name: "PayPal", provider: "paypal" });
    await expect(zuordnung.importCsvZuordnung(actor, file, { accountId: paypal.id, headerRow: v.headerRow, mapping: v.mapping })).rejects.toThrow(
      "ist ein Zahlungsdienstleister",
    );
    expect((await sql`select csv_mapping from bank_accounts where id = ${paypal.id}`)[0]!.csv_mapping).toBeNull();
  });

  it("meldet Fehler bekannter Formate weiter als Fehler, nicht als unbekannte Bank", async () => {
    const konto = await account();
    // Kopfzeile der Commerzbank, Betrag kaputt
    const kaputt = new TextEncoder().encode(
      "Buchungstag;Wertstellung;Umsatzart;Buchungstext;Betrag;Währung;IBAN Kontoinhaber;Kategorie;Sender;Empfänger;Verwendungszweck\n01.10.2026;01.10.2026;Lastschrift;x;abc;EUR;DE89370400440532013000;;;;\n",
    );
    const fehler = await zuordnung.importStatementFile(actor, { bytes: kaputt, filename: "cb.csv" }, konto.id).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(bank.BankError);
    expect(fehler).not.toBeInstanceOf(zuordnung.UnbekannteCsvError);
  });
});
