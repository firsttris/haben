import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Kontenrahmenwechsel und das Zwischenkonto einer Gutschrift „erstattet bereits Bezahltes“ (#786): Gebuchte Belege sind
 * unveränderlich, ihre Buchung trägt den Kontenrahmen von damals. Ein Wechsel SKR03 → SKR04 zum Jahreswechsel zieht sie
 * deshalb nicht mit: Die Gutschrift bleibt mit 1548 gebucht. Ausgeglichen wird sie im neuen Jahr im neuen Rahmen — die
 * Umbuchung muss den geparkten Betrag trotzdem finden und darf ihn nicht ein zweites Mal umbuchen. Sie bucht deshalb
 * 1434 an 1406, damit Kz 66 die Minderung im neuen Rahmen sieht.
 */

describe.skipIf(!testDatabaseUrl)("Vorsteuer-Ausgleich über einen Kontenrahmenwechsel (Postgres, #786)", () => {
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("./index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let sql: postgres.Sql;
  const actor = "ausgleich-kontenrahmen";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 44]);
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    bank = await import("./index.ts");
    vat = await import("../umsatzsteuer/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma() {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03', 'einzelunternehmen', 14)`;
  }

  /** Gutschrift über 100,00 € netto zu 19 %, gebucht im alten Rahmen */
  async function gutschrift(datum: string) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `wechsel-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `GS-${lauf}`,
      documentDate: datum,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes: true,
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Wechsel zum Jahreswechsel; die Sperre der Firmendaten gilt für das laufende Jahr, hier bucht niemand mehr */
  async function wechselNachSkr04() {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update company set kontenrahmen = 'SKR04' where id = 1`;
    });
  }

  /** Erstattung über einen echten Bankumsatz; `betrag` in Cent, positiv wie auf dem Konto */
  async function erstattung(documentId: string, betrag: number, datum: string) {
    const euro = (betrag / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Erstattung";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `erstattung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions where booking_date = ${datum} order by created_at desc limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  it("im neuen Jahr bucht die Umbuchung 1434 an 1406, und Kz 66 sieht die Minderung", async () => {
    await firma();
    const id = await gutschrift("2026-12-15");
    await wechselNachSkr04();

    await erstattung(id, 11_900, "2027-01-05");

    const zeilen = await sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l
        join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' and e.date = '2027-01-05' order by l.account`;
    expect(zeilen).toContainEqual({ account: "1434", debit: 1_900, credit: 0, tax_code: "VSt19" });
    expect(zeilen).toContainEqual({ account: "1406", debit: 0, credit: 1_900, tax_code: "VSt19" });
    // Der alte Rahmen bleibt unverändert: gebuchte Belege ziehen nicht mit
    const [alt] = await sql`select coalesce(sum(credit - debit), 0)::int as saldo from journal_lines where account = '1548'`;
    expect(alt!.saldo).toBe(1_900);
    // Kz 66 im Januar: die Minderung steht jetzt in der Voranmeldung, nicht rückwirkend im Dezember
    expect((await vat.computeVatFigures({ year: 2027, month: 1 })).kz66).toBe(-1_900);
    expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz66).toBe(0);
  }, 30_000);

  it("was vor dem Wechsel schon umgebucht war, wird nicht ein zweites Mal umgebucht", async () => {
    await firma();
    const id = await gutschrift("2026-12-15");
    // Teilerstattung im alten Rahmen: 950 von 1.900 sind umgebucht
    await erstattung(id, 5_950, "2026-12-20");
    await wechselNachSkr04();

    await erstattung(id, 5_950, "2027-01-05");

    const [umbuchung] = await sql`select coalesce(sum(debit - credit), 0)::int as bewegt from journal_lines l
        join journal_entries e on e.id = l.entry_id
       where l.account = '1434' and e.date = '2027-01-05'`;
    expect(umbuchung!.bewegt).toBe(950);
    // Beide Umbuchungen zusammen genau die Vorsteuer des Belegs, und das Konto ist über beide Rahmen ausgeglichen
    const [gesamt] = await sql`select coalesce(sum(debit), 0)::int as soll, coalesce(sum(debit - credit), 0)::int as saldo
       from journal_lines where account in ('1548', '1434')`;
    expect(gesamt).toEqual({ soll: 1_900, saldo: 0 });
    expect((await vat.computeVatFigures({ year: 2027, month: 1 })).kz66).toBe(-950);
    expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz66).toBe(-950);
  }, 30_000);

  it("ohne die Angabe bucht auch nach dem Wechsel nichts um", async () => {
    await firma();
    // Altbestand: keine Angabe, die Vorsteuer ist im Belegmonat schon gemindert
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `wechsel-alt-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `GS-alt-${lauf}`,
      documentDate: "2026-12-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    await documents.bookDocument(actor, id);
    await wechselNachSkr04();

    await erstattung(id, 11_900, "2027-01-05");

    const [zeilen] = await sql`select count(*)::int as n from journal_lines where account in ('1548', '1434')`;
    expect(zeilen!.n).toBe(0);
    const [vorsteuer] = await sql`select coalesce(sum(debit - credit), 0)::int as bewegt from journal_lines where account = '1406'`;
    expect(vorsteuer!.bewegt).toBe(0);
  }, 30_000);
});
