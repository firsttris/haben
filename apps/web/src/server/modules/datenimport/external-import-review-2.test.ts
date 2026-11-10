import type postgres from "postgres";
import { createHash } from "node:crypto";
import { sql as query } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Belegimport: zweite unabhängige Reviewrunde (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let cash: typeof import("../bank/index.ts");
  let ledger: typeof import("../buchhaltung/index.ts");
  let database: typeof import("../../db/index.ts");
  let reports: typeof import("../auswertungen/index.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    cash = await import("../bank/index.ts");
    ledger = await import("../buchhaltung/index.ts");
    database = await import("../../db/index.ts");
    reports = await import("../auswertungen/index.ts");
  }, 30_000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`truncate seals, company, contacts, quotes, invoices, cash_entries, journal_entries, external_imports, lexoffice_imports cascade`;
    });
    await sql`insert into company (id,name,kleinunternehmer,rechtsform,kontenrahmen,bundesland)
      values (1,'Erfundener Reviewbetrieb',true,'einzelunternehmen','SKR03','NI')`;
  });

  for (const chart of ["SKR03", "SKR04"] as const)
    for (const tax of ["ist", "soll"] as const)
      it(`hält nach übernommener Bareinnahme Kassenbuch und Kassenkonto gleich für ${chart}/${tax}`, async () => {
        await sql`update company set kontenrahmen=${chart},versteuerung=${tax}`;
        const account = chart === "SKR03" ? "1000" : "1600";
        await imports.runExternalImport(
          "review-user",
          {
            version: 2,
            source: "erfundener-kassenexport",
            kontenrahmen: chart,
            entries: [
              {
                kind: "journal",
                externalId: "bareinnahme-42",
                date: "2026-01-05",
                description: "Erfundene Barzahlung aus Originalkassenbuch",
                lines: [
                  { account, debit: 40000, credit: 0 },
                  { account: chart === "SKR03" ? "1400" : "1200", debit: 0, credit: 40000 },
                ],
              },
            ],
          },
          async () => new Uint8Array(),
        );
        const journal = await ledger.kontenblatt(account, { from: "2026-01-01", to: "2027-01-01" });
        expect(journal.saldo).toBe(40000);
        expect((await cash.cashBook(2026)).closing, "Übernommenes Bargeld muss auch im Kassenbuch verfügbar sein").toBe(journal.saldo);
        expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
        const book = await cash.cashBook(2026);
        const original = book.entries[0]!;
        expect(original).toMatchObject({ kind: "import", amount: 40000, invoiceId: null, taxTreatment: null });
        expect(await cash.cashBookCsv(2026)).toContain("Übernommene Kassenbewegung");
        expect(await sql`select * from journal_entries`).toHaveLength(1);
        expect(await sql`select actor from audit_log where table_name='cash_entries' and row_id=${original.id}`).toEqual([{ actor: "review-user" }]);
        await expect(cash.reverseCashEntry("review-user", original.id, "2026-01-06")).rejects.toThrow("Originalbuchungen");
        expect((await cash.cashBook(2026)).closing).toBe(40000);
        expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
        expect(await sql`select * from haben_integrity_problems(5)`).toHaveLength(0);
        await expect(cash.createCashEntry("review-user", { kind: "entnahme", date: "2026-01-06", amount: 10000 }, "2026-01-06")).resolves.toBeDefined();
      });

  const cashJournal = (externalId: string, date: string, amount: number) => ({
    kind: "journal" as const,
    externalId,
    date,
    description: "Erfundene ursprüngliche Kassenbewegung",
    lines: [
      { account: "1000", debit: Math.max(0, amount), credit: Math.max(0, -amount) },
      { account: "1890", debit: Math.max(0, -amount), credit: Math.max(0, amount) },
    ],
  });
  const run = (entries: Parameters<typeof imports.runExternalImport>[1]["entries"]) =>
    imports.runExternalImport("review-user", { version: 2, source: "review-kasse", kontenrahmen: "SKR03", entries }, async () => new Uint8Array());

  it("übernimmt die Kasse chronologisch und idempotent ohne erfundene EÜR-Zahlung", async () => {
    const entries = [cashJournal("ausgang", "2026-01-06", -10000), cashJournal("eingang", "2026-01-05", 40000)];
    expect(await run(entries)).toMatchObject({ created: 2, duplicates: 0 });
    expect(await run(entries)).toMatchObject({ created: 0, duplicates: 2 });
    expect((await cash.cashBook(2026)).entries.map((entry) => [entry.number, entry.amount, entry.balance])).toEqual([
      [1, 40000, 40000],
      [2, -10000, 30000],
    ]);
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
    expect(await sql`select * from journal_entries`).toHaveLength(2);
    await expect(cash.createCashEntry("review-user", { kind: "entnahme", date: "2026-01-07", amount: 30001 }, "2026-01-07")).rejects.toThrow("negativ");
  });

  it("rollt ein Paket mit negativem Tagesbestand samt Journal und Herkunft zurück", async () => {
    await expect(run([cashJournal("eingang", "2026-01-05", 10000), cashJournal("ausgang", "2026-01-06", -20000)])).rejects.toThrow("negativ");
    expect(await sql`select * from cash_entries`).toHaveLength(0);
    expect(await sql`select * from journal_entries`).toHaveLength(0);
    expect(await sql`select * from external_imports`).toHaveLength(0);
  });

  it("erfindet aus der Kassenübernahme weder EÜR-Nachweise noch einen zweiten Rechnungszahlungsstand", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const result = await imports.runExternalImport(
      "review-user",
      {
        version: 2,
        source: "review-ungeklaerte-kasse",
        kontenrahmen: "SKR03",
        entries: [
          {
            kind: "invoice",
            type: "invoice",
            direction: "einnahme",
            status: "paid",
            currency: "EUR",
            externalId: "rechnung-42",
            number: "ALT-42",
            date: "2026-01-03",
            dueDate: "2026-01-17",
            contactId: null,
            contactName: "Erfundener Kunde",
            net: 40000,
            tax: 0,
            gross: 40000,
            taxes: [{ rate: 0, net: 40000, tax: 0 }],
            taxType: "vatfree",
            payment: { openAmount: 0, paidDate: null, items: [] },
            pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          },
          cashJournal("kasse-42", "2026-01-05", 40000),
        ],
      },
      async () => pdf,
    );
    const archive = await import("../archiv/index.ts");
    const invoiceId = result.items.find((i) => i.kind === "invoice")!.id;
    expect((await archive.legacyVoucherDetail(invoiceId))?.voucher).toMatchObject({
      status: "paid",
      paymentHistoryIssue: expect.stringContaining("ungeklärt"),
    });
    expect(await sql`select * from invoices`).toHaveLength(0);
    expect((await reports.euerForYear(2026)).totalEinnahmen).toBe(0);
    expect((await cash.cashBook(2026)).closing).toBe(40000);
    const [movement] = await sql`select id from cash_entries where kind='import'`;
    await expect(cash.reverseCashEntry("review-user", movement!.id as string, "2026-01-06")).rejects.toThrow("Originalbuchungen");
    expect((await archive.legacyVoucherDetail(invoiceId))?.voucher.paymentHistoryIssue).toContain("ungeklärt");
    expect(result.created).toBe(2);
  });

  it("prüft bei bestehenden späteren Kassenbewegungen den gesamten Importbestand", async () => {
    await cash.createCashEntry("review-user", { kind: "einlage", date: "2026-01-05", amount: 10000 }, "2026-01-07");
    await cash.createCashEntry("review-user", { kind: "entnahme", date: "2026-01-07", amount: 10000 }, "2026-01-07");
    await run([cashJournal("ausgang", "2026-01-06", -10000), cashJournal("eingang", "2026-01-07", 10000)]);
    expect((await cash.cashBook(2026)).closing).toBe(0);
    expect((await ledger.kontenblatt("1000", { from: "2026-01-01", to: "2027-01-01" })).saldo).toBe(0);
  });

  it("sperrt die Kasse vor dem ersten Audit-Eintrag eines Pakets auch neben einem nativen Kassenweg", async () => {
    let locked!: () => void;
    let proceed!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const native = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('haben.kasse'))`;
      locked();
      await release;
      await tx`set local lock_timeout = '2s'`;
      // Ein nativer Kassenweg hält schon die Kasse und benötigt als Nächstes die Audit-Kette.
      await tx`select haben_lock_audit_chain()`;
    });
    await acquired;
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const imported = imports.runExternalImport(
      "review-user",
      {
        version: 2,
        source: "review-locks",
        kontenrahmen: "SKR03",
        entries: [
          {
            kind: "quote",
            status: "open",
            currency: "EUR",
            externalId: "angebot-vor-kasse",
            number: "ALT-42",
            date: "2026-01-03",
            validUntil: null,
            contactId: null,
            contactName: "Erfundener Kunde",
            net: 40000,
            tax: 0,
            gross: 40000,
            pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          },
          cashJournal("eingang", "2026-01-05", 40000),
        ],
      },
      async () => pdf,
    );
    const observed = imported.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const rows = await database.db.execute<{ n: number }>(query`select count(*)::int as n from pg_stat_activity
          where datname=current_database() and wait_event='advisory' and query like '%haben.kasse%'`);
        waiting = Number(rows[0]?.n) > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting, "Der Import muss zuerst auf die Kassensperre warten").toBe(true);
    } finally {
      proceed();
      await native;
    }
    expect(await observed).toMatchObject({ result: { created: 2 } });
    expect((await cash.cashBook(2026)).closing).toBe(40000);
  });
});
