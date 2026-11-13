import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Buchung der Verrechnung zweier Belege (#786, Etappe 3): Jede Belegseite bekommt ihre eigene Buchung, Verbindlichkeiten
 * gegen das Verrechnungskonto (SKR03 1590, SKR04 1370), mit ihrer Zeile in `document_settlements` als Quelle und damit
 * ihrem Beleg. Erst dieser Vorgangsbezug gibt dem DATEV-Export das Personenkonto; eine gemeinsame Sammelbuchung über beide
 * Belege (#785) hatte ihn nicht. Die Seite der Gutschrift „erstattet bereits Bezahltes“ trägt zusätzlich die Umbuchung der
 * Vorsteuer aus dem Zwischenkonto, damit Aufheben und Storno beide zusammen umdrehen.
 *
 * Altbestand: Verrechnungen von vor dieser Etappe haben entweder keine Buchung oder nur die Umbuchung der Vorsteuer. Sie
 * werden nicht rückwirkend umgebaut; beim Aufheben wird genau das umgedreht, was damals gebucht wurde.
 */

const KONTEN = {
  SKR03: { zwischen: "1548", vorsteuer: "1576", verrechnung: "1590", verbindlichkeiten: "1600" },
  SKR04: { zwischen: "1434", vorsteuer: "1406", verrechnung: "1370", verbindlichkeiten: "3300" },
} as const;

describe.skipIf(!testDatabaseUrl)("Verrechnung bucht je Belegseite (#786, Etappe 3)", () => {
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let sql: postgres.Sql;
  const actor = "verrechnung-buchung";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 17]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    verrechnung = await import("./verrechnung.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04" = "SKR03") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, year_closings, write_offs, allocations,
      cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts,
      document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', ${kontenrahmen}, 'einzelunternehmen', 14)`;
  }

  /** Gebuchter Beleg über die Bank; negative Beträge ergeben eine Gutschrift des Lieferanten */
  async function beleg(input: { datum: string; net: number; tax: number; erstattetBezahltes?: boolean; nummer?: string }) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: input.nummer ?? `B-${lauf}`,
      documentDate: input.datum,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes: input.erstattetBezahltes ?? false,
      currency: "EUR",
      exchangeRate: null,
      amounts: [{ taxRate: 1900, net: input.net, tax: input.tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Buchungen einer Verrechnung mit ihren Zeilen, je Buchung nach Konto sortiert */
  async function buchungen() {
    const entries = await sql`select id, date, description, source_id, reverses_id from journal_entries
        where source_type = 'verrechnung' order by created_at, id`;
    const result = [];
    for (const entry of entries) {
      const lines = await sql`select account, debit, credit, tax_code, basis from journal_lines
          where entry_id = ${entry.id} order by account, debit desc`;
      result.push({ entry, lines });
    }
    return result;
  }

  const saldo = async (konto: string) =>
    Number((await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account = ${konto}`)[0]!.saldo);

  it("bucht je Belegseite eine Buchung mit ihrem Beleg, ohne Steuerzeile bei einem gewöhnlichen Beleg", async () => {
    await firma();
    const k = KONTEN.SKR03;
    const rechnung = await beleg({ datum: "2026-02-10", net: 10_000, tax: 1_900, nummer: "RE-100" });
    const gutschrift = await beleg({ datum: "2026-02-16", net: -10_000, tax: -1_900, nummer: "GS-200" });

    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 5_950,
      date: "2026-02-16",
      note: "Teilverrechnung",
    });

    const gebucht = await buchungen();
    expect(gebucht).toHaveLength(2);
    // Die Quelle ist die Zeile der jeweiligen Belegseite, nicht das Paar
    expect(gebucht.map((b) => b.entry.source_id)).toEqual(expect.arrayContaining(ids));
    expect(new Set(gebucht.map((b) => b.entry.source_id)).size).toBe(2);

    // Rechnung: Soll Verbindlichkeiten an Verrechnungskonto; Gutschrift: umgekehrt
    const rechnungsseite = gebucht.find((b) => b.entry.description.includes("RE-100"))!;
    expect(rechnungsseite.entry.description).toBe("Verrechnung · Beleg RE-100 · Stadtwerke Beispiel GmbH");
    expect(rechnungsseite.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      [k.verrechnung, 0, 5_950],
      [k.verbindlichkeiten, 5_950, 0],
    ]);
    const gutschriftseite = gebucht.find((b) => b.entry.description.includes("GS-200"))!;
    expect(gutschriftseite.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      [k.verrechnung, 5_950, 0],
      [k.verbindlichkeiten, 0, 5_950],
    ]);
    // Keine Steuerzeile: Der gewöhnliche Beleg hat seine Vorsteuer schon im Belegmonat gezogen
    expect(gutschriftseite.lines.every((l) => l.tax_code === null && l.basis === null)).toBe(true);
    expect(await saldo(k.verrechnung)).toBe(0);
    expect(await saldo(k.verbindlichkeiten)).toBe(0);
  }, 30_000);

  it("hängt die Umbuchung der Vorsteuer an die Buchung der Gutschrift", async () => {
    await firma();
    const k = KONTEN.SKR03;
    const rechnung = await beleg({ datum: "2026-02-10", net: 10_000, tax: 1_900, nummer: "RE-101" });
    const gutschrift = await beleg({ datum: "2026-02-16", net: -10_000, tax: -1_900, erstattetBezahltes: true, nummer: "GS-201" });

    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 5_950,
      date: "2026-02-16",
      note: "Teilverrechnung",
    });

    const gebucht = await buchungen();
    const gutschriftseite = gebucht.find((b) => b.entry.description.includes("GS-201"))!;
    // Soll Verrechnungskonto 59,50 € / Haben Verbindlichkeiten 59,50 €, dazu Soll Zwischenkonto 9,50 € / Haben Vorsteuer 9,50 €
    expect(gutschriftseite.lines).toEqual([
      { account: k.zwischen, debit: 950, credit: 0, tax_code: "VSt19", basis: 5_000 },
      { account: k.vorsteuer, debit: 0, credit: 950, tax_code: "VSt19", basis: null },
      { account: k.verrechnung, debit: 5_950, credit: 0, tax_code: null, basis: null },
      { account: k.verbindlichkeiten, debit: 0, credit: 5_950, tax_code: null, basis: null },
    ]);
    const soll = gutschriftseite.lines.reduce((s, l) => s + l.debit, 0);
    const haben = gutschriftseite.lines.reduce((s, l) => s + l.credit, 0);
    expect(soll).toBe(haben);
    expect(await saldo(k.vorsteuer)).toBe(950);
    expect(await saldo(k.zwischen)).toBe(-950);
  }, 30_000);

  it("hebt je Seite mit einer Gegenbuchung am Tag der Aufhebung auf", async () => {
    await firma();
    const k = KONTEN.SKR03;
    const rechnung = await beleg({ datum: "2026-03-10", net: 10_000, tax: 1_900, nummer: "RE-102" });
    const gutschrift = await beleg({ datum: "2026-03-12", net: -10_000, tax: -1_900, erstattetBezahltes: true, nummer: "GS-202" });
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 5_950,
      date: "2026-03-12",
      note: "Teilverrechnung",
    });
    const vorher = await buchungen();

    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-03-20", "Korrektur");

    const nachher = await buchungen();
    expect(nachher).toHaveLength(4);
    const gegen = nachher.filter((b) => b.entry.reverses_id !== null);
    expect(gegen).toHaveLength(2);
    // Gegenbuchungen tragen den Tag der Aufhebung und verweisen auf die Buchung ihrer Seite
    expect(gegen.every((b) => b.entry.date === "2026-03-20")).toBe(true);
    expect(gegen.map((b) => b.entry.reverses_id)).toEqual(expect.arrayContaining(vorher.map((b) => b.entry.id)));
    // Verrechnungskonto und Verbindlichkeiten stehen wieder auf null; die Vorsteuer der Rechnung und das
    // Zwischenkonto der Gutschrift stehen wie vor der Aufrechnung
    expect(await saldo(k.verrechnung)).toBe(0);
    expect(await saldo(k.verbindlichkeiten)).toBe(0);
    expect(await saldo(k.vorsteuer)).toBe(1_900);
    expect(await saldo(k.zwischen)).toBe(-1_900);
  }, 30_000);

  it("lässt Verrechnungen ohne Buchung (Altbestand) unverändert und hebt sie ohne Gegenbuchung auf", async () => {
    await firma();
    const rechnung = await beleg({ datum: "2026-04-10", net: 10_000, tax: 1_900 });
    const gutschrift = await beleg({ datum: "2026-04-12", net: -3_000, tax: -570 });
    const paar = crypto.randomUUID();
    const [zeile] = await sql`insert into document_settlements (document_id, counter_document_id, settlement_id, date, amount, note, created_by)
      values (${rechnung}, ${gutschrift}, ${paar}, '2026-04-12', -3_000, 'Altbestand', ${actor}) returning id`;
    await sql`insert into document_settlements (document_id, counter_document_id, settlement_id, date, amount, note, created_by)
      values (${gutschrift}, ${rechnung}, ${paar}, '2026-04-12', 3_000, 'Altbestand', ${actor})`;

    await verrechnung.reverseSettlement(actor, zeile!.id as string, "2026-04-20");

    // Nichts nachgebucht: Die alte Verrechnung bleibt, wie sie war, die Gegenzeile zählt wie bisher
    expect(await buchungen()).toHaveLength(0);
    expect(await verrechnung.openAmount(rechnung)).toBe(11_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-3_570);
  }, 30_000);

  it("dreht eine alte Buchung um, die nur die Umbuchung der Vorsteuer enthielt", async () => {
    await firma();
    const k = KONTEN.SKR03;
    const rechnung = await beleg({ datum: "2026-05-10", net: 10_000, tax: 1_900 });
    const gutschrift = await beleg({ datum: "2026-05-12", net: -10_000, tax: -1_900, erstattetBezahltes: true });
    const paar = crypto.randomUUID();
    const [zeile] = await sql`insert into document_settlements (document_id, counter_document_id, settlement_id, date, amount, note, created_by)
      values (${rechnung}, ${gutschrift}, ${paar}, '2026-05-12', -5_950, 'Altbestand', ${actor}) returning id`;
    const [gegenseite] = await sql`insert into document_settlements (document_id, counter_document_id, settlement_id, date, amount, note, created_by)
      values (${gutschrift}, ${rechnung}, ${paar}, '2026-05-12', 5_950, 'Altbestand', ${actor}) returning id`;
    // So buchte Etappe 2: nur die Umbuchung vom Zwischenkonto auf die Vorsteuer, ohne die Buchung der Belegseite selbst.
    // In einer Transaktion wie das Hauptbuch: Zeilen anlegen, dann festschreiben (Trigger aus drizzle 0058 und 0065)
    const [alt] = await sql.begin(async (tx) => {
      const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-05-12', 'Vorsteuer aus Verrechnung · Beleg 2026-05-12', 'verrechnung', ${gegenseite!.id}, 'SKR03')
        returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit, tax_code, basis)
        values (${entry!.id}, ${k.zwischen}, 950, 0, 'VSt19', 5_000), (${entry!.id}, ${k.vorsteuer}, 0, 950, 'VSt19', null)`;
      await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
      return [entry];
    });

    await verrechnung.reverseSettlement(actor, zeile!.id as string, "2026-05-20");

    // Die alte Buchung wird umgedreht, ohne neue Verrechnungsbuchung auf den Verbindlichkeiten
    const alle = await buchungen();
    expect(alle).toHaveLength(2);
    const gegen = alle.find((b) => b.entry.reverses_id !== null)!;
    expect(gegen.entry).toMatchObject({ date: "2026-05-20", reverses_id: alt!.id });
    expect(gegen.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      [k.zwischen, 0, 950],
      [k.vorsteuer, 950, 0],
    ]);
    expect(await saldo(k.zwischen)).toBe(-1_900);
    expect(await saldo(k.vorsteuer)).toBe(1_900);
  }, 30_000);

  it("bucht im zweiten Kontenrahmen auf dessen Verrechnungskonto", async () => {
    await firma("SKR04");
    const k = KONTEN.SKR04;
    const rechnung = await beleg({ datum: "2026-06-10", net: 10_000, tax: 1_900, nummer: "RE-400" });
    const gutschrift = await beleg({ datum: "2026-06-12", net: -10_000, tax: -1_900, nummer: "GS-400" });

    await verrechnung.settleDocuments(actor, {
      documentId: gutschrift,
      counterDocumentId: rechnung,
      amount: 5_950,
      date: "2026-06-12",
      note: "Gutschrift zuerst geöffnet",
    });

    const gebucht = await buchungen();
    expect(gebucht).toHaveLength(2);
    expect(gebucht.flatMap((b) => b.lines.map((l) => l.account))).toEqual(expect.arrayContaining([k.verrechnung, k.verbindlichkeiten]));
    expect(await saldo(ACCOUNTS.SKR04.verrechnung)).toBe(0);
    expect(await saldo(ACCOUNTS.SKR04.verbindlichkeiten)).toBe(0);
  }, 30_000);
});
