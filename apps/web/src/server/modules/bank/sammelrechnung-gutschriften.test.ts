import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Gutschriften beim Sammelknopf (#680): Etsy rechnet Gebührengutschriften in die Monatsrechnung ein. Im Juni 2023 waren
 * das 119,29 € Gebühren minus 2,72 € Gutschriften, Rechnung über 116,57 €. Bisher nahm der Knopf nur die Gebühren und
 * ließ 2,72 € Gebühren und 2,72 € Gutschriften offen. Ergeben alle offenen Gebühren und Gutschriften des Monats genau
 * den offenen Betrag des Belegs, ordnet er alle Zeilen in einem Schritt zu; jede bleibt eine eigene Buchung.
 * Beleg nach § 13b (Etsy Ireland UC), SKR03 und SKR04, Ist und Soll.
 */

const ETSY_OKTOBER = [
  `Date,Type,Title,Info,Currency,Amount,"Fees & Taxes",Net,"Tax Details"`,
  `"October 1, 2026",Fee,"Einstellgebühr","",EUR,--,-€7.44,-€7.44,--`,
  `"October 2, 2026",Fee,"Transaktionsgebühr","",EUR,--,-€9.89,-€9.89,--`,
  `"October 3, 2026",Fee,"Zahlungsabwicklung","",EUR,--,-€8.19,-€8.19,--`,
  `"October 4, 2026",Marketing,"Etsy Ads","",EUR,--,-€93.77,-€93.77,--`,
  `"October 5, 2026",Fee,"Credit for transaction fee","",EUR,--,€1.50,€1.50,--`,
  `"October 6, 2026",Fee,"Gutschrift für Einstellgebühr","",EUR,--,€1.22,€1.22,--`,
].join("\n");

/** 744 + 989 + 819 + 9377 Gebühren minus 150 + 122 Gutschriften */
const RECHNUNG = 11_657;
const STEUER_13B = 2_215;

const VERBINDLICHKEITEN = { SKR03: "1600", SKR04: "3300" } as const;

describe.skipIf(!testDatabaseUrl)("Sammelknopf mit Gutschriften (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let documents: typeof import("../belege/documents.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    documents = await import("../belege/documents.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines,
      journal_entries, document_splits, document_amounts, documents, company cascade`;
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kontenrahmen}, ${versteuerung})`;
    const etsy = await bank.createProviderAccount(actor, { name: "Etsy", provider: "etsy" });
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(ETSY_OKTOBER), filename: "etsy.csv" }, etsy.id);
  }

  /** Gebührenrechnung von Etsy Ireland UC, § 13b (Leistung aus dem EU-Ausland), 19 % */
  async function rechnung13b(net: number) {
    seq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seq, 80]), filename: `etsy-${seq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Etsy Ireland UC",
      supplierUstId: "IE9777587C",
      invoiceNumber: `ETSY-${seq}`,
      documentDate: "2026-10-31",
      dueDate: null,
      category: "sonstiges",
      payment: "bank",
      note: "",
      reverseCharge: "eu",
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  const ersteGebuehr = async () => (await sql<{ id: string }[]>`select id from bank_transactions where amount = -744`)[0]!.id;

  /** Gebühren- und Gutschriftzeilen des Monats mit ihrem zugeordneten Betrag */
  const zeilen = () =>
    sql<{ amount: number; zugeordnet: number }[]>`select t.amount, coalesce(sum(a.amount), 0)::int as zugeordnet
      from bank_transactions t left join allocations a on a.transaction_id = t.id
      where t.purpose like 'Gebühr%' group by t.id, t.amount order by t.booking_date`;

  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const) {
    it(`${kontenrahmen}, ${versteuerung}: Gebühren und Gutschriften ergeben genau den Beleg, alle Zeilen in einem Schritt`, async () => {
      await firma(kontenrahmen, versteuerung);
      const docId = await rechnung13b(RECHNUNG);

      // Der Vorschlag rechnet die Gutschriften mit: Der Beleg ist der Sammelbeleg des Monats
      const detail = await bank.transactionDetail(await ersteGebuehr());
      expect(detail?.sammelrechnung).toEqual({ summe: -RECHNUNG, documentId: docId });

      expect(await bank.allocateFeesToDocument(actor, { transactionId: await ersteGebuehr(), documentId: docId })).toBe(6);

      // Jede Zeile ganz zugeordnet, keine offen; der Beleg steht auf 0,00 €
      expect((await zeilen()).every((z) => z.zugeordnet === z.amount)).toBe(true);
      expect((await bank.openItems()).filter((i) => i.type === "document")).toEqual([]);

      // Jede Zeile eine eigene Buchung; zusammen tilgen sie genau die Verbindlichkeit des Belegs
      const buchungen = await sql<{ soll: number; haben: number }[]>`select l.debit as soll, l.credit as haben
        from journal_lines l join journal_entries e on e.id = l.entry_id join allocations a on a.id = e.source_id
        where e.source_type = 'allocation' and a.document_id = ${docId} and l.account = ${VERBINDLICHKEITEN[kontenrahmen]}`;
      expect(buchungen).toHaveLength(6);
      expect(buchungen.reduce((s, b) => s + b.soll - b.haben, 0)).toBe(RECHNUNG);

      // § 13b läuft einmal über den Beleg, über den Rechnungsbetrag (Gebühren minus Gutschriften)
      const oktober = await vat.computeVatFigures({ year: 2026, month: 10 });
      expect([oktober.kz46, oktober.kz47, oktober.kz67]).toEqual([RECHNUNG, STEUER_13B, STEUER_13B]);
    }, 30_000);
  }

  it("ergeben Gebühren und Gutschriften nicht genau den Beleg, bleiben die Gutschriften offen wie bisher (SKR04, Ist)", async () => {
    await firma("SKR04", "ist");
    const docId = await rechnung13b(10_000);
    expect(await bank.allocateFeesToDocument(actor, { transactionId: await ersteGebuehr(), documentId: docId })).toBe(4);
    const offen = (await zeilen()).filter((z) => z.zugeordnet !== z.amount);
    expect(offen.map((z) => z.amount).filter((a) => a > 0)).toEqual([150, 122]);
    const [summe] = await sql<{ summe: number }[]>`select coalesce(sum(amount), 0)::int as summe from allocations where document_id = ${docId}`;
    expect(summe!.summe).toBe(-10_000);
  }, 30_000);
});
