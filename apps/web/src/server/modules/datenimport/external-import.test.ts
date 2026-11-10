import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Allgemeiner Belegimport (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let db: typeof import("../../db/index.ts");
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF");
  const hash = createHash("sha256").update(pdf).digest("hex");
  const buyer = { name: "Beispielkunde", strasse: "Musterweg 1", plz: "10115", ort: "Berlin", land: "DE" };
  const base = {
    externalId: "a-1",
    number: "0042",
    date: "2026-01-03",
    contactId: null,
    buyer,
    gross: 100000,
    lines: [{ description: "Leistung", detail: "Beschreibung", quantity: 1000, unit: "Psch." as const, unitPrice: 100000 }],
    pdfSha256: hash,
  };
  const quote = () => ({ ...base, kind: "quote" as const, validUntil: "2026-02-03" });
  const invoice = () => ({ ...base, kind: "invoice" as const, externalId: "r-1", number: "10042", dueDate: "2026-01-17" });
  const journal = () => ({
    kind: "journal" as const,
    externalId: "j-1",
    date: "2026-01-05",
    description: "Übernommene Zahlung",
    lines: [
      { account: "1200", debit: 100000, credit: 0 },
      { account: "1400", debit: 0, credit: 100000 },
    ],
    cashFlows: [{ date: "2026-01-05", amount: 100000, category: "einnahme" as const, evidence: "Umsatzexport, Zeile 42" }],
  });
  const run = (entries: Parameters<typeof imports.runExternalImport>[1]["entries"], kontenrahmen: "SKR03" | "SKR04" = "SKR03") =>
    imports.runExternalImport("import-user", { version: 1, source: "test-app", kontenrahmen, entries }, async () => pdf);

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    invoices = await import("../rechnungen/index.ts");
    reports = await import("../auswertungen/index.ts");
    db = await import("../../db/index.ts");
  }, 30_000);
  afterAll(async () => {
    await db?.closeDatabase();
    await sql?.end();
  });
  beforeEach(async () => {
    // Nur die Wegwerf-Datenbank dieses Test-Workers leeren; danach gelten wieder alle Sperren und Siegel.
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`truncate seals, company, contacts, quotes, invoices, journal_entries, external_imports, invoice_number_counters, quote_number_counters cascade`;
    });
    await sql`insert into company (id,name,kleinunternehmer,rechtsform,kontenrahmen,bundesland) values (1,'Testbetrieb',true,'einzelunternehmen','SKR03','NI')`;
  });

  it("übernimmt Originalnummer/PDF, Angebot, Verknüpfung, Journal und OPOS; Wiederholung bleibt ohne Wirkung", async () => {
    const data: Parameters<typeof imports.runExternalImport>[1]["entries"] = [
      { ...invoice(), quoteExternalId: "a-1", settledAmount: 40000 },
      quote(),
      {
        ...journal(),
        lines: [
          { account: "1200", debit: 40000, credit: 0 },
          { account: "1400", debit: 0, credit: 40000 },
        ],
        cashFlows: [{ date: "2026-01-05", amount: 40000, category: "einnahme", evidence: "Umsatzexport" }],
      },
    ];
    const first = await run(data);
    expect(first).toMatchObject({ created: 3, duplicates: 0 });
    expect(await run(data)).toMatchObject({ created: 0, duplicates: 3 });
    const rows = await sql`select number,pdf,pdf_sha256,status,quote_id,locked_at from invoices`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: "10042", pdf_sha256: hash, status: "final" });
    expect(Buffer.from(rows[0]!.pdf)).toEqual(Buffer.from(pdf));
    expect(rows[0]!.quote_id).toBeTruthy();
    expect(rows[0]!.locked_at).toBeTruthy();
    expect(await invoices.listInvoices("2026-02-01")).toEqual([expect.objectContaining({ number: "10042", paid: 40000, open: 60000 })]);
    expect((await reports.openPositions("2026-02-01")).receivablesTotal).toBe(60000);
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(40000);
    expect(await sql`select * from invoice_number_counters`).toHaveLength(0);
    expect(await sql`select * from quote_number_counters`).toHaveLength(0);
    expect(await sql`select * from haben_integrity_problems(5)`).toHaveLength(0);
    expect((await sql`select distinct actor from audit_log where table_name='external_imports'`).map((r) => r.actor)).toEqual(["import-user"]);
  });

  it("übernimmt bestätigt bezahlt ohne geschätztes EÜR-Datum oder fingierten Bankumsatz", async () => {
    await run([{ ...invoice(), settledAmount: 100000, paymentUncertain: true }]);
    expect((await invoices.listInvoices("2026-02-01"))[0]).toMatchObject({ listStatus: "bezahlt", open: 0 });
    expect((await reports.openPositions("2026-02-01")).receivables).toHaveLength(0);
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
    expect(await reports.uncertainImportPayments(2026)).toBe(1);
    expect(await sql`select * from bank_transactions`).toHaveLength(0);
    expect(await sql`select * from journal_entries`).toHaveLength(0);
    const id = (await sql`select id from invoices`)[0]!.id as string;
    await expect(invoices.cancelInvoice("import-user", id, "2026-02-01")).rejects.toThrow("Originalbuchungen");
    await expect(invoices.createCorrection("import-user", id, "2026-02-01")).rejects.toThrow("Originalbuchungen");
  });

  it("erhält gleiche Angebotsnummern verschiedener Quellidentitäten; native Nummern bleiben geschützt", async () => {
    await run([quote(), { ...quote(), externalId: "a-2", buyer: { ...buyer, name: "Anderer Empfänger" } }]);
    expect(await sql`select * from quotes where number='0042'`).toHaveLength(2);
    await expect(
      sql`insert into quotes (number,status,issue_date,valid_until,locked_at) values ('0042','final','2026-01-03','2026-02-03',now())`,
    ).rejects.toThrow();
  });

  it("erfindet für ein Angebot ohne übernommene Gültigkeit keine abgelaufene Frist", async () => {
    await run([{ ...quote(), validUntil: null }]);
    expect((await invoices.listQuotes("2026-12-31"))[0]).toMatchObject({ validUntil: null, listStatus: "offen" });
    const id = (await sql`select id from quotes`)[0]!.id as string;
    const copy = await invoices.copyQuote("import-user", id, "2026-02-01");
    expect(copy.validUntil).not.toBeNull();
  });

  it("erhält verschiedene Originalrechnungen mit gleicher Quellnummer, ohne native Doppelnummern zu erlauben", async () => {
    await run([invoice(), { ...invoice(), externalId: "r-2", date: "2026-01-04", buyer: { ...buyer, name: "Anderer Empfänger" } }]);
    expect(await sql`select * from invoices where number='10042'`).toHaveLength(2);
    await expect(
      sql`insert into invoices (number,status,issue_date,due_date,locked_at) values ('10042','final','2026-01-05','2026-01-17',now())`,
    ).rejects.toThrow();
  });

  it("rollt das ganze Paket bei abweichendem Betrag oder veränderter Quellidentität zurück", async () => {
    await expect(run([quote(), { ...invoice(), gross: 99999 }])).rejects.toThrow("Originalbetrag");
    expect(await sql`select * from quotes`).toHaveLength(0);
    await run([invoice()]);
    await expect(run([quote(), { ...invoice(), note: "Nachträgliche Änderung" }])).rejects.toThrow("verändert");
    expect(await sql`select * from quotes`).toHaveLength(0);
  });

  it("ist auch bei gleichzeitigen Wiederholungen idempotent und schützt importierte Daten", async () => {
    const results = await Promise.all([run([invoice(), journal()]), run([invoice(), journal()])]);
    expect(results.map((r) => r.created).sort()).toEqual([0, 2]);
    await expect(sql`update external_imports set settled_amount=1`).rejects.toThrow();
    await expect(sql`delete from external_imports`).rejects.toThrow();
    await expect(sql`truncate external_imports`).rejects.toThrow();
    await expect(sql`update invoices set gross=1 where status='final'`).rejects.toThrow();
    await expect(sql`delete from journal_entries`).rejects.toThrow();
  });

  it("prüft Originalhash, Buchungsgleichheit und Zu-/Abfluss vor jeder Übernahme", async () => {
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
    await expect(run([{ ...journal(), cashFlows: [{ date: "2026-01-05", amount: 99999, category: "einnahme", evidence: "Nachweis" }] }])).rejects.toThrow(
      "Geldbewegung",
    );
    expect(await sql`select * from external_imports`).toHaveLength(0);
  });

  for (const chart of ["SKR03", "SKR04"] as const)
    for (const tax of ["ist", "soll"] as const) {
      it(`belegte EÜR ohne Steuer und OPOS stimmen für ${chart}/${tax}`, async () => {
        await sql`update company set kontenrahmen=${chart},versteuerung=${tax}`;
        const j = journal();
        if (chart === "SKR04")
          j.lines = [
            { account: "1800", debit: 100000, credit: 0 },
            { account: "1200", debit: 0, credit: 100000 },
          ];
        await run([{ ...invoice(), settledAmount: 100000 }, j], chart);
        expect((await reports.euerForYear(2026)).einnahmen.find((r) => r.key === "einnahmenKleinunternehmer")?.amount).toBe(100000);
        expect((await reports.openPositions("2026-02-01")).receivablesTotal).toBe(0);
        expect(await sql`select * from haben_integrity_problems(5)`).toHaveLength(0);
      });
    }
});
