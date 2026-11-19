import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Sammelrechnung des Monats an einer Gebührenzeile (Refs #680): Etsy bucht jede Gebühr als eigene Zeile, die
 * Gebührenrechnung trägt die Summe des Monats. Eine einzelne Zeile (−7,44 €) passt nie auf den Beleg (−116,57 €).
 * Kontenrahmen: der Vorschlag bucht nichts; die Zuordnung bucht über die Kategorie des Belegs, darum einmal SKR04.
 */

const ETSY_OKTOBER = [
  `Date,Type,Title,Info,Currency,Amount,"Fees & Taxes",Net,"Tax Details"`,
  `"October 1, 2026",Fee,"Einstellgebühr","",EUR,--,-€7.44,-€7.44,--`,
  `"October 2, 2026",Fee,"Transaktionsgebühr","",EUR,--,-€9.89,-€9.89,--`,
  `"October 3, 2026",Fee,"Zahlungsabwicklung","",EUR,--,-€8.19,-€8.19,--`,
  `"October 4, 2026",Fee,"Werbung","",EUR,--,-€91.05,-€91.05,--`,
].join("\n");

describe.skipIf(!testDatabaseUrl)("Sammelrechnung an einer Gebührenzeile (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, company cascade`;
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04") {
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kontenrahmen}, 'ist')`;
  }

  async function etsyOktober() {
    const etsy = await bank.createProviderAccount(actor, { name: "Etsy", provider: "etsy" });
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(ETSY_OKTOBER), filename: "etsy.csv" }, etsy.id);
  }

  async function beleg(nr: number, supplierName: string, documentDate: string, net: number) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, nr]), filename: `beleg-${nr}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName,
      supplierUstId: "",
      invoiceNumber: `R-${nr}`,
      documentDate,
      dueDate: null,
      category: "sonstiges",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 0, net, tax: 0 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  const ersteGebuehr = async () => (await sql<{ id: string }[]>`select id from bank_transactions where amount = -744`)[0]!.id;

  it("der Beleg über die Monatssumme steht an der Gebührenzeile ganz oben", async () => {
    await firma("SKR03");
    await etsyOktober();
    const docId = await beleg(21, "Etsy Ireland UC", "2026-10-31", 11_657); // 744 + 989 + 819 + 9105
    const detail = await bank.transactionDetail(await ersteGebuehr());
    expect(detail?.suggestions[0]?.item).toMatchObject({ type: "document", id: docId, open: -11_657 });
    expect(detail?.suggestions[0]?.reasons).toContain("Betrag stimmt exakt");
    expect(detail?.sammelrechnung).toEqual({ summe: -11_657, documentId: docId });
  }, 30_000);

  it("passt die Monatssumme zu keinem Beleg, gibt es keinen Sammelvorschlag, nur die Summe", async () => {
    await firma("SKR03");
    await etsyOktober();
    const docId = await beleg(22, "Acme GmbH", "2026-01-15", 10_000);
    const detail = await bank.transactionDetail(await ersteGebuehr());
    expect(detail?.suggestions.some((s) => s.item.id === docId)).toBe(false);
    expect(detail?.sammelrechnung).toEqual({ summe: -11_657, documentId: null });
  }, 30_000);

  it("lässt einen offenen Dublettenverdacht in Vorschlag und Sammelzuordnung außen vor", async () => {
    await firma("SKR03");
    await etsyOktober();
    const originalId = await ersteGebuehr();
    const etsy = (await bank.listAccounts()).find((konto) => konto.provider === "etsy")!;
    const zweiteDatei = ETSY_OKTOBER.split("\n").slice(0, 2).join("\n").replace("Einstellgebühr", "EinstellgebührX");
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(zweiteDatei), filename: "etsy-nachtrag.csv" }, etsy.id);
    const [verdacht] = await sql<{ id: string }[]>`select id from bank_transactions where amount = -744 and id <> ${originalId}`;
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', ${actor}, true)`;
      await tx`insert into bank_duplicate_reviews (transaction_id, original_transaction_id) values (${verdacht!.id}, ${originalId})`;
    });
    const docId = await beleg(24, "Etsy Ireland UC", "2026-10-31", 11_657);

    expect((await bank.transactionDetail(originalId))?.sammelrechnung).toEqual({ summe: -11_657, documentId: docId });
    await expect(bank.allocateFeesToDocument(actor, { transactionId: verdacht!.id, documentId: docId })).rejects.toThrow(/Dublettenverdacht/);
    expect(await bank.allocateFeesToDocument(actor, { transactionId: originalId, documentId: docId })).toBe(4);
    const [zugeordnet] = await sql<{ summe: number; verdacht: boolean }[]>`select
      coalesce(sum(amount), 0)::int as summe, bool_or(transaction_id = ${verdacht!.id}) as verdacht
      from allocations where document_id = ${docId}`;
    expect(zugeordnet).toEqual({ summe: -11_657, verdacht: false });
  }, 30_000);

  // Gutschriften (#680) machen die Rechnung kleiner als die Summe der Gebührenzeilen. Die Sammelzuordnung bricht dann
  // nicht ab, sondern ordnet wie bisher zu, bis der Beleg aufgebraucht ist.
  it("weicht die Monatssumme vom gewählten Beleg ab, ordnet die Sammelzuordnung bis zum Betrag des Belegs zu (SKR04)", async () => {
    await firma("SKR04");
    await etsyOktober();
    const docId = await beleg(23, "Etsy Ireland UC", "2026-10-31", 10_000);
    expect(await bank.allocateFeesToDocument(actor, { transactionId: await ersteGebuehr(), documentId: docId })).toBe(4);
    const [zugeordnet] = await sql<{ summe: number }[]>`select coalesce(sum(amount), 0)::int as summe from allocations where document_id = ${docId}`;
    expect(zugeordnet!.summe).toBe(-10_000);
  }, 30_000);
});
