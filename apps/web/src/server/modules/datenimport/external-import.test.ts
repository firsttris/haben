import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Allgemeiner Belegimport im gemeinsamen Umzugsbestand (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let archive: typeof import("../archiv/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let database: typeof import("../../db/index.ts");
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF");
  const hash = createHash("sha256").update(pdf).digest("hex");
  const base = {
    externalId: "a-1",
    number: "0042",
    date: "2026-01-03",
    contactId: null,
    contactName: "Beispielkunde",
    currency: "EUR" as const,
    net: 100000,
    tax: 0,
    gross: 100000,
    pdfSha256: hash,
  };
  const quote = () => ({ ...base, kind: "quote" as const, status: "open" as const, validUntil: null });
  const invoice = () => ({
    ...base,
    kind: "invoice" as const,
    type: "invoice" as const,
    direction: "einnahme" as const,
    externalId: "r-1",
    number: "10042",
    dueDate: "2026-01-17",
    status: "open" as const,
    taxes: [{ rate: 0, net: 100000, tax: 0 }],
    taxType: "vatfree",
    payment: null,
  });
  const journal = () => ({
    kind: "journal" as const,
    externalId: "j-1",
    date: "2026-01-05",
    description: "Übernommene ursprüngliche Buchung",
    lines: [
      { account: "1200", debit: 40000, credit: 0 },
      { account: "1400", debit: 0, credit: 40000 },
    ],
  });
  const run = (entries: Parameters<typeof imports.runExternalImport>[1]["entries"], kontenrahmen: "SKR03" | "SKR04" = "SKR03") =>
    imports.runExternalImport("import-user", { version: 2, source: "test-app", kontenrahmen, entries }, async () => pdf);

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    archive = await import("../archiv/index.ts");
    reports = await import("../auswertungen/index.ts");
    database = await import("../../db/index.ts");
  }, 30_000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`truncate seals, company, contacts, quotes, invoices, cash_entries, journal_entries, external_imports, lexoffice_imports, invoice_number_counters, quote_number_counters cascade`;
    });
    await sql`insert into company (id,name,kleinunternehmer,rechtsform,kontenrahmen,bundesland) values (1,'Testbetrieb',true,'einzelunternehmen','SKR03','NI')`;
  });

  it("erhält Original-PDFs, Nummern, Herkunft und Journal im gemeinsamen Umzugsbestand; Wiederholung bleibt ohne Wirkung", async () => {
    const data = [invoice(), quote(), journal()];
    expect(await run(data)).toMatchObject({ created: 3, duplicates: 0 });
    expect(await run(data)).toMatchObject({ created: 0, duplicates: 3 });
    expect(await sql`select source,number,gross from lexoffice_vouchers`).toEqual([{ source: "import", number: "10042", gross: 100000 }]);
    expect(await sql`select source,number,status from legacy_order_documents`).toEqual([{ source: "import", number: "0042", status: "open" }]);
    const [file] = await sql`select sha256 from lexoffice_voucher_files`;
    const { loadFile } = await import("../../storage.ts");
    expect(await loadFile(file!.sha256)).toEqual(Buffer.from(pdf));
    expect(await sql`select * from invoices`).toHaveLength(0);
    expect(await sql`select * from quotes`).toHaveLength(0);
    expect(await sql`select * from invoice_number_counters`).toHaveLength(0);
    expect(await sql`select * from quote_number_counters`).toHaveLength(0);
    expect(await sql`select * from journal_entries`).toHaveLength(1);
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
    expect(await sql`select * from haben_integrity_problems(5)`).toHaveLength(0);
    expect((await sql`select distinct actor from audit_log where table_name='external_imports'`).map((r) => r.actor)).toEqual(["import-user"]);
  });

  it("übernimmt bestätigt bezahlt ohne geschätztes EÜR-Datum oder fingierten Bankumsatz", async () => {
    const result = await run([{ ...invoice(), status: "paid", payment: { openAmount: 0, paidDate: null, items: [] } }]);
    const detail = await archive.legacyVoucherDetail(result.items[0]!.id);
    expect(detail?.voucher).toMatchObject({ status: "paid", paymentHistoryIssue: expect.stringContaining("ungeklärt") });
    expect(detail?.voucher.payment?.items).toEqual([]);
    expect(detail?.voucher.payment?.paidDate).toBeNull();
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
    expect(await sql`select * from bank_transactions`).toHaveLength(0);
    expect(await sql`select * from journal_entries`).toHaveLength(0);
  });

  it("speichert belegte Einzelzahlungen im vorhandenen Zahlungsbestand statt einer zweiten EÜR-Quelle", async () => {
    const result = await run([
      {
        ...invoice(),
        status: "paid",
        payment: { openAmount: 0, paidDate: "2026-01-05", items: [{ date: "2026-01-05", amount: 100000, evidence: "Originalauszug, Zeile 42" }] },
      },
    ]);
    expect(await sql`select source,amount,date::text from legacy_voucher_payments`).toEqual([{ source: "import", amount: 100000, date: "2026-01-05" }]);
    const detail = await archive.legacyVoucherDetail(result.items[0]!.id);
    expect(detail?.voucher.paymentHistoryIssue).toBeNull();
    expect(detail?.voucher.payment?.items).toHaveLength(1);
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
    expect(await sql`select * from bank_transactions`).toHaveLength(0);
  });

  it("erhält verschiedene Originale mit gleicher Nummer, weist eine kollidierende native Übernahme aber ab", async () => {
    const result = await run([quote(), { ...quote(), externalId: "a-2", contactName: "Anderer Empfänger" }, invoice(), { ...invoice(), externalId: "r-2" }]);
    expect(await sql`select * from legacy_order_documents where number='0042'`).toHaveLength(2);
    expect(await sql`select * from lexoffice_vouchers where number='10042'`).toHaveLength(2);
    const first = result.items.find((i) => i.externalId === "r-1")!;
    const second = result.items.find((i) => i.externalId === "r-2")!;
    await archive.takeOverLegacyItem("import-user", first.id, "2026-01-31");
    await expect(archive.takeOverLegacyItem("import-user", second.id, "2026-01-31")).rejects.toThrow("Rechnungsnummer");
    expect(await sql`select * from invoices where number='10042'`).toHaveLength(1);
    expect((await reports.openPositions("2026-02-01")).receivablesTotal).toBe(100000);
  });

  it("erfindet für ein Originalangebot keine Frist und ändert native Angebotsregeln nicht", async () => {
    await run([quote()]);
    const [row] = await sql`select raw from legacy_order_documents`;
    expect(row!.raw.validUntil).toBeNull();
    expect(await sql`select * from quotes`).toHaveLength(0);
    const [column] = await sql`select attnotnull from pg_attribute where attrelid='quotes'::regclass and attname='valid_until'`;
    expect(column!.attnotnull).toBe(true);
  });

  it("verhindert doppelte Eröffnungen neben einem Quelljournal und umgekehrt", async () => {
    const first = await run([
      invoice(),
      {
        ...journal(),
        lines: [
          { account: "1400", debit: 100000, credit: 0 },
          { account: "8195", debit: 0, credit: 100000 },
        ],
      },
    ]);
    await expect(archive.takeOverLegacyItem("import-user", first.items.find((i) => i.kind === "invoice")!.id, "2026-01-31")).rejects.toThrow("Quelljournal");
    expect(await sql`select * from journal_entries`).toHaveLength(1);
    expect(await sql`select * from invoices`).toHaveLength(0);
  });

  it("bucht nach einer nativen OPOS-Übernahme kein fremdes Journal derselben Quelle nach", async () => {
    const first = await run([invoice()]);
    await archive.takeOverLegacyItem("import-user", first.items[0]!.id, "2026-01-31");
    await expect(run([{ ...journal(), date: "2026-02-05" }])).rejects.toThrow("schon nativ übernommen");
    expect(await sql`select * from journal_entries`).toHaveLength(1);
    expect(await sql`select * from external_imports`).toHaveLength(1);
  });

  it("bewahrt eine fehlende Fälligkeit und blockiert die native Übernahme ohne Ersatzdatum", async () => {
    const result = await run([{ ...invoice(), dueDate: null }]);
    await expect(archive.takeOverLegacyItem("import-user", result.items[0]!.id, "2026-01-31")).rejects.toThrow("Fälligkeit");
    expect((await sql`select due_date from lexoffice_vouchers`)[0]!.due_date).toBeNull();
  });

  it("rollt das ganze Paket bei Betragsfehler, fehlendem Kontakt oder veränderter Quellidentität zurück", async () => {
    await expect(run([quote(), { ...invoice(), gross: 99999 }])).rejects.toThrow("Gesamtbetrag");
    expect(await sql`select * from legacy_order_documents`).toHaveLength(0);
    await expect(run([quote(), { ...invoice(), contactId: "00000000-0000-4000-8000-000000000001" }])).rejects.toThrow("Kontakt");
    expect(await sql`select * from legacy_order_documents`).toHaveLength(0);
    await run([invoice()]);
    await expect(run([quote(), { ...invoice(), note: "Geändert" }])).rejects.toThrow("verändert");
    expect(await sql`select * from legacy_order_documents`).toHaveLength(0);
  });

  it("ist parallel idempotent und schützt Herkunft, Originale und Journal", async () => {
    const results = await Promise.all([run([invoice(), journal()]), run([invoice(), journal()])]);
    expect(results.map((r) => r.created).sort()).toEqual([0, 2]);
    await expect(sql`update external_imports set payload_hash='0'`).rejects.toThrow();
    await expect(sql`delete from external_imports`).rejects.toThrow();
    await expect(sql`truncate external_imports`).rejects.toThrow();
    await expect(sql`update lexoffice_vouchers set gross=1`).rejects.toThrow();
    await expect(sql`delete from journal_entries`).rejects.toThrow();
  });

  it("prüft Originalhash und ausgeglichene Buchung; lehnt alte Finanzfelder statt stiller Umdeutung ab", async () => {
    await expect(run([{ ...invoice(), pdfSha256: "0".repeat(64) }])).rejects.toThrow("Hash");
    await expect(
      run([
        {
          ...journal(),
          lines: [
            { account: "1200", debit: 1, credit: 0 },
            { account: "1400", debit: 0, credit: 2 },
          ],
        },
      ]),
    ).rejects.toThrow("ausgeglichen");
    const { externalImportSchema } = await import("./external-schema.ts");
    expect(externalImportSchema.safeParse({ version: 1, source: "test-app", kontenrahmen: "SKR03", entries: [invoice()] }).success).toBe(false);
    expect(externalImportSchema.safeParse({ version: 2, source: "test-app", kontenrahmen: "SKR03", entries: [{ ...journal(), cashFlows: [] }] }).success).toBe(
      false,
    );
    expect(await sql`select * from external_imports`).toHaveLength(0);
  });

  for (const chart of ["SKR03", "SKR04"] as const)
    for (const tax of ["ist", "soll"] as const)
      for (const form of ["einzelunternehmen", "gmbh"] as const)
        it(`gemeinsamer Eingang und Journal bleiben konsistent für ${chart}/${tax}/${form}`, async () => {
          await sql`update company set kontenrahmen=${chart},versteuerung=${tax},rechtsform=${form}`;
          const account = chart === "SKR03" ? "1000" : "1600";
          await run(
            [
              invoice(),
              {
                ...journal(),
                lines: [
                  { account, debit: 40000, credit: 0 },
                  { account: chart === "SKR03" ? "1400" : "1200", debit: 0, credit: 40000 },
                ],
              },
            ],
            chart,
          );
          const { cashBook } = await import("../bank/index.ts");
          expect((await cashBook(2026)).closing).toBe(40000);
          expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
          expect(await sql`select * from haben_integrity_problems(5)`).toHaveLength(0);
        });
});
