import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Unabhängiges TDD-Review R1 zu PR #926, F1: Testfälle und Erwartungen unverändert übernommen.
// § 11 Abs. 2 EStG: Ausgaben wirken im Abflussjahr. Eine später erklärte Aufhebung darf die
// unveränderte andere Zahlung im Vorjahr nicht neu runden. Nur synthetische Daten.
// https://www.gesetze-im-internet.de/estg/__11.html
describe.skipIf(!testDatabaseUrl)("EÜR-Teilabzug bei Aufhebung im Folgejahr", () => {
  let sql: postgres.Sql;
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("./reports.ts");
  let journal: typeof import("./euer-quelle.ts");
  let db: typeof import("../../db/index.ts").db;
  let seq = 0;
  const actor = "review-926";

  beforeAll(async () => {
    sql = await setupTestDb();
    db = (await import("../../db/index.ts")).db;
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("./reports.ts");
    journal = await import("./euer-quelle.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function pay(documentId: string, date: string, amount: number) {
    const [account] = await sql`select id from bank_accounts limit 1`;
    const [imported] = await sql`insert into bank_imports(bank_account_id,filename,sha256,format,added,skipped)
      values(${account!.id},'synthetisch.csv',${`review-926-${++seq}`},'csv',1,0) returning id`;
    const [transaction] = await sql`insert into bank_transactions(bank_account_id,import_id,booking_date,amount,purpose,dedup_hash)
      values(${account!.id},${imported!.id},${date},${amount},'Testzahlung',${`review-926-${seq}`}) returning id`;
    await bank.allocate(actor, { kind: "document", transactionId: transaction!.id as string, documentId, amount });
    const [allocation] = await sql`select id from allocations where transaction_id=${transaction!.id} and reverses_id is null`;
    return allocation!.id as string;
  }

  async function values(year: number) {
    const results = [await reports.euerAusNebenbuechern(year, db), await journal.euerAusDemJournal(year, db)];
    return results.map((result) => ["ausgabe:software", "vorsteuer"].map((key) => result.ausgaben.find((line) => line.key === key)?.amount ?? 0));
  }

  it.each([
    { kr: "SKR03", art: "ist", net: 14, tax: 3, payment: 6, expense: 11, inputTax: 1, reversedExpense: -5, reversedTax: -1 },
    { kr: "SKR04", art: "soll", net: 14, tax: 3, payment: 6, expense: 11, inputTax: 1, reversedExpense: -5, reversedTax: -1 },
    { kr: "SKR03", art: "ist", net: 10_001, tax: 1_900, payment: 3_966, expense: 7_299, inputTax: 633, reversedExpense: -3_649, reversedTax: -317 },
    { kr: "SKR04", art: "soll", net: 10_001, tax: 1_900, payment: 3_966, expense: 7_299, inputTax: 633, reversedExpense: -3_649, reversedTax: -317 },
  ] as const)(
    "$kr/$art, $net + $tax Cent: Folgejahresaufhebung ändert keine Vorjahreszahlung",
    async ({ kr, art, net, tax, payment, expense, inputTax, reversedExpense, reversedTax }) => {
      await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, asset_depreciations, assets,
      journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
      await sql`insert into company(id,name,strasse,plz,ort,email,steuernummer,bundesland,versteuerung,kontenrahmen)
      values(1,'Testfirma','Testweg 1','93047','Regensburg','test@example.com','198/113/10010','BY',${art},${kr})`;
      await sql`insert into bank_accounts(name,iban) values('Testkonto','DE89370400440532013000')`;
      const { id } = await documents.uploadDocument(actor, {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, ++seq]),
        filename: `review-${seq}.jpg`,
      });
      await documents.updateDocument(actor, id, {
        supplierName: "Testlieferant",
        supplierUstId: "",
        invoiceNumber: `R-${seq}`,
        documentDate: "2025-09-15",
        dueDate: null,
        category: "software",
        note: "",
        payment: "bank",
        vorsteuerAnteil: 5_000,
        amounts: [{ taxRate: 1900, net, tax }],
      });
      await documents.bookDocument(actor, id);
      const first = await pay(id, "2025-09-20", -payment);
      await pay(id, "2025-10-20", -payment);
      expect(await values(2025)).toEqual([
        [expense, inputTax],
        [expense, inputTax],
      ]);
      await bank.reverseAllocation(actor, first, "2026-02-20");
      // Die zweite 2025er Zahlung ist unverändert; die Gegenzeile gehört ausschließlich nach 2026.
      expect({ previous: await values(2025), current: await values(2026) }).toEqual({
        previous: [
          [expense, inputTax],
          [expense, inputTax],
        ],
        current: [
          [reversedExpense, reversedTax],
          [reversedExpense, reversedTax],
        ],
      });
    },
  );
});
