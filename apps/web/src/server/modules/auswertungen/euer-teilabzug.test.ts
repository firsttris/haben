import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(date: string, amount: string) {
  const columns = [
    "Buchungsdatum",
    "Wertstellung",
    "Status",
    "Zahlungspflichtige*r",
    "Zahlungsempfänger*in",
    "Verwendungszweck",
    "Umsatztyp",
    "IBAN",
    "Betrag (€)",
    "Gläubiger-ID",
    "Mandatsreferenz",
    "Kundenreferenz",
  ];
  const row = [date, date, "Gebucht", "Testfirma", "Lieferant", "Testzahlung", "Ausgang", "DE02100100100006820101", amount, "", "", ""];
  const csvRow = (cells: string[]) => cells.map((c) => `"${c}"`).join(";");
  return new TextEncoder().encode(`"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n${csvRow(columns)}\n${csvRow(row)}\n`);
}

describe.skipIf(!testDatabaseUrl)("EÜR-Teilabzug: Journal und Nebenbücher (Postgres, #433)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("./reports.ts");
  let quelle: typeof import("./euer-quelle.ts");
  let abgleich: typeof import("./abgleich.ts");
  let db: typeof import("../../db/index.ts").db;
  const actor = "euer-teilabzug-test";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    db = (await import("../../db/index.ts")).db;
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("./reports.ts");
    quelle = await import("./euer-quelle.ts");
    abgleich = await import("./abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04", art: "ist" | "soll") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, asset_depreciations, assets, journal_lines,
      journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Testweg 1', '93047', 'Regensburg', 'test@example.com', '198/113/10010', 'BY', ${art}, ${kr})`;
  }

  type Amount = { taxRate: 1900 | 700 | 0; net: number; tax: number; vorsteuerAnteil?: number | null };
  async function book(
    options: { amounts?: Amount[]; vorsteuerAnteil?: number; privateShare?: number; payment?: "bank" | "privat"; reverseCharge?: "eu" | "ig_erwerb" } = {},
  ) {
    seq++;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seq % 256, Math.floor(seq / 256), 27]),
      filename: `euer-teil-${seq}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: options.reverseCharge === "ig_erwerb" ? "ATU12345675" : "",
      invoiceNumber: `ET-${seq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      note: "",
      payment: options.payment ?? "bank",
      vorsteuerAnteil: options.vorsteuerAnteil ?? 5_000,
      privateShare: options.privateShare ?? 0,
      reverseCharge: options.reverseCharge ?? null,
      amounts: options.amounts ?? [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function transaction(date: string, amount: string) {
    await bank.importStatement(actor, { bytes: dkbCsv(date, amount), filename: `zahlung-${seq}-${date}-${amount}.csv` }, null);
    const [row] = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions order by created_at desc limit 1`;
    return row!;
  }

  const amount = (euer: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) =>
    [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;

  async function compare(year: number, expense: number, vorsteuer: number) {
    for (const euer of [await reports.euerAusNebenbuechern(year, db), await quelle.euerAusDemJournal(year, db)]) {
      expect(amount(euer, "ausgabe:software")).toBe(expense);
      expect(amount(euer, "vorsteuer")).toBe(vorsteuer);
    }
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen)).toEqual([]);
  }

  it("SKR03, Ist: gespeicherte Satzanteile mit Privatanteil gelten auch nach Änderung der Firmenvorgabe", async () => {
    await reset("SKR03", "ist");
    await book({
      payment: "privat",
      privateShare: 20,
      amounts: [
        { taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 2_500 },
        { taxRate: 700, net: 10_000, tax: 700, vorsteuerAnteil: null },
      ],
    });
    await sql`update company set ohne_vorsteuerabzug=true`;
    // Geschäftlich 16.000 + 2.080 Steuer; 25 % von 1.520 + 50 % von 560 sind 660 Cent.
    await compare(2026, 17_420, 660);
  });

  it("SKR04, Soll: zwei Teilzahlungen über den Jahreswechsel verwenden denselben gespeicherten Abzug", async () => {
    await reset("SKR04", "soll");
    const id = await book();
    const erste = await transaction("20.09.26", "-59,50");
    await bank.allocate(actor, { kind: "document", documentId: id, transactionId: erste.id, amount: erste.amount });
    const zweite = await transaction("20.01.27", "-59,50");
    await bank.allocate(actor, { kind: "document", documentId: id, transactionId: zweite.id, amount: zweite.amount });
    await compare(2026, 5_475, 475);
    await compare(2027, 5_475, 475);
  });

  it("13 Cent, 50 %: drei Teilzahlungen über den Jahreswechsel verteilen genau 2 Cent Vorsteuer", async () => {
    await reset("SKR04", "soll");
    const id = await book({ amounts: [{ taxRate: 1900, net: 10, tax: 3 }] });
    for (const [date, value] of [
      ["20.09.26", "-0,04"],
      ["20.01.27", "-0,04"],
      ["20.02.27", "-0,05"],
    ]) {
      const t = await transaction(date!, value!);
      await bank.allocate(actor, { kind: "document", documentId: id, transactionId: t.id, amount: t.amount });
    }
    await compare(2026, 3, 1);
    await compare(2027, 8, 1);
    const [erste] = await sql<{ id: string }[]>`select a.id from allocations a join bank_transactions b on b.id=a.transaction_id
      where a.document_id=${id} and a.reverses_id is null order by b.booking_date, a.created_at limit 1`;
    await bank.reverseAllocation(actor, erste!.id);
    await compare(2026, 0, 0);
    await compare(2027, 8, 1);
  });

  it.each(["eu", "ig_erwerb"] as const)("%s: nicht abziehbare Steuer wird erst bei der Finanzamtszahlung EÜR-Ausgabe", async (reverseCharge) => {
    await reset("SKR03", "ist");
    await book({ payment: "privat", reverseCharge });
    await compare(2026, 10_000, 0);
    const zahlung = await transaction("20.10.26", "-9,50");
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: zahlung.id, amount: zahlung.amount });
    const nebenbuch = await reports.euerAusNebenbuechern(2026, db);
    const journal = await quelle.euerAusDemJournal(2026, db);
    expect([nebenbuch.totalAusgaben, journal.totalAusgaben]).toEqual([10_950, 10_950]);
    expect(amount(nebenbuch, "gezahlteUst")).toBe(950);
    await compare(2026, 10_000, 0);
  });
});
