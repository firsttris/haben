import { ACCOUNTS, type Kontenrahmen } from "@haben/core";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #750: Nur bilanzierte Forderungen gehen in den Laufzeitvorschlag ein. Die vereinbarten langen Fälligkeiten werden
 * wie in restlaufzeiten.test.ts als Datensätze angelegt; Entwurf → Final und Journal behalten alle Sperren und Siegel.
 */
describe.skipIf(!testDatabaseUrl)("Restlaufzeiten neuer Anzahlungs- und Schlussketten (Postgres)", () => {
  let sql: postgres.Sql;
  let database: typeof import("../../db/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let bookkeeping: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let frame: Kontenrahmen;
  let seq = 0;
  const actor = "advance-restlaufzeiten-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    database = await import("../../db/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
    bookkeeping = await import("./index.ts");
    bank = await import("../bank/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    seq = 0;
    frame = "SKR03";
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts,
      cash_entries, residual_terms cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,iban,kontenrahmen,versteuerung,rechtsform,journal_ab)
      values (1,'Muster GmbH','Musterstraße 1','93047','Regensburg','rechnung@example.com','198/113/10010','BY',
        'DE89370400440532013000','SKR03','soll','gmbh',2025)`;
  });

  async function invoice(input: {
    date: string;
    dueDate: string;
    gross: number;
    marker?: "deferred" | null;
    variant?: "abschlag" | "schluss";
    performance?: string;
    deducts?: string;
    replaces?: string;
    cancels?: string;
  }) {
    return withActor(actor, async (tx) => {
      const { schema } = database;
      const [row] = await tx
        .insert(schema.invoices)
        .values({
          issueDate: input.date,
          dueDate: input.dueDate,
          serviceFrom: input.performance ?? null,
          net: input.gross,
          tax: 0,
          gross: input.gross,
          kind: input.cancels ? "storno" : "rechnung",
          correctsId: input.cancels ?? null,
          variant: input.variant ?? null,
          advanceType: input.variant === "abschlag" ? "anzahlung" : null,
          advanceAccounting: input.marker ?? null,
          replacesInvoiceId: input.replaces ?? null,
          taxTreatment: "steuerfrei",
        })
        .returning();
      await tx.insert(schema.invoiceTaxes).values({ invoiceId: row!.id, rate: 0, base: input.gross, tax: 0 });
      const [deducted] = input.deducts ? await tx.select().from(schema.invoices).where(eq(schema.invoices.id, input.deducts)) : [];
      const itemNet = input.gross + (deducted?.gross ?? 0);
      await tx.insert(schema.invoiceLines).values({
        invoiceId: row!.id,
        position: 1,
        description: "Vereinbarte Leistung",
        quantity: 1000,
        unit: "Psch.",
        unitPrice: itemNet,
        taxRate: 0,
        net: itemNet,
      });
      if (deducted)
        await tx.insert(schema.invoiceLines).values({
          invoiceId: row!.id,
          position: 2,
          description: "Abzug Anforderung",
          quantity: 1000,
          unit: "Psch.",
          unitPrice: -deducted.gross,
          taxRate: 0,
          net: -deducted.gross,
          deductionOf: deducted.id,
        });
      const [finalized] = await tx
        .update(schema.invoices)
        .set({ status: "final", number: `RLZ-750-${++seq}`, lockedAt: new Date() })
        .where(eq(schema.invoices.id, row!.id))
        .returning();
      return finalized!;
    });
  }
  async function book(date: string, invoiceId: string, lines: [string, number, number][]) {
    await withActor(actor, async (tx) =>
      bookkeeping.post(tx, await bookkeeping.openBooks(tx), {
        date,
        description: "Laufzeit-Test",
        sourceType: "invoice",
        sourceId: invoiceId,
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }
  const paid = (id: string, date: string, amount: number) => bank.createCashInvoiceEntry(actor, { invoiceId: id, date, amount }, "2026-12-31");
  async function receivables(year: number) {
    const view = await bookkeeping.restlaufzeitenAnsicht(year);
    return view!.jahr.zeilen.find((row) => row.account === ACCOUNTS[frame].forderungen);
  }

  it("eine lange unbezahlte oder teilbezahlte Anforderung macht einen anderen kurzen Forderungssaldo nicht langfristig", async () => {
    const a = ACCOUNTS[frame];
    const short = await invoice({ date: "2025-11-01", dueDate: "2026-01-01", gross: 100_000 });
    await book("2025-11-01", short.id, [
      [a.forderungen, 100_000, 0],
      [a.erloese[1900], 0, 100_000],
    ]);
    await invoice({ date: "2025-11-02", dueDate: "2028-06-30", gross: 35_700, variant: "abschlag", marker: "deferred" });
    const partial = await invoice({ date: "2025-11-03", dueDate: "2028-06-30", gross: 35_700, variant: "abschlag", marker: "deferred" });
    await paid(partial.id, "2025-12-12", 11_900);
    expect(await receivables(2025)).toMatchObject({ betrag: 100_000, vorschlag: 0, eingabe: true });
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("SKR04/Ist: Papierstorno erhält die damalige lange Forderung; späterer Ersatz und Zahlung ziehen sie nicht vor", async () => {
    frame = "SKR04";
    await sql`update company set kontenrahmen='SKR04', versteuerung='ist', rechtsform='ug'`;
    const a = ACCOUNTS[frame];
    const advance = await invoice({ date: "2025-10-01", dueDate: "2025-10-15", gross: 30_000, variant: "abschlag", marker: "deferred" });
    await paid(advance.id, "2025-10-10", 30_000);
    const final = await invoice({
      date: "2025-11-01",
      dueDate: "2028-06-30",
      performance: "2025-11-01",
      gross: 70_000,
      variant: "schluss",
      marker: "deferred",
      deducts: advance.id,
    });
    await book("2025-11-01", final.id, [
      [a.forderungen, 70_000, 0],
      [a.erloese[1900], 0, 70_000],
    ]);
    await book("2025-11-01", advance.id, [
      [a.erhalteneAnzahlungen, 30_000, 0],
      [a.erloese[1900], 0, 30_000],
    ]);
    await paid(final.id, "2025-11-05", 10_000);
    await invoice({ date: "2025-12-15", dueDate: "2025-12-15", gross: -70_000, marker: "deferred", cancels: final.id });
    const replacement = await invoice({
      date: "2026-03-12",
      dueDate: "2027-06-30",
      performance: "2025-11-01",
      gross: 70_000,
      variant: "schluss",
      marker: "deferred",
      deducts: advance.id,
      replaces: final.id,
    });
    await paid(replacement.id, "2026-04-10", 20_000);
    expect(await receivables(2025)).toMatchObject({ betrag: 60_000, vorschlag: 60_000 });
    expect(await receivables(2026)).toMatchObject({ betrag: 40_000, vorschlag: 0 });
  });

  it("ein bei Leistung unbezahlter Abschlag wird bilanziert; markerlose Altabschläge behalten ihren bisherigen Vorschlag", async () => {
    const a = ACCOUNTS[frame];
    const advance = await invoice({ date: "2025-10-01", dueDate: "2028-06-30", gross: 30_000, variant: "abschlag", marker: "deferred" });
    const final = await invoice({
      date: "2025-11-01",
      dueDate: "2025-12-01",
      performance: "2025-11-01",
      gross: 70_000,
      variant: "schluss",
      marker: "deferred",
      deducts: advance.id,
    });
    const old = await invoice({ date: "2025-10-02", dueDate: "2028-06-30", gross: 50_000, variant: "abschlag" });
    await book("2025-11-01", advance.id, [
      [a.forderungen, 30_000, 0],
      [a.erloese[1900], 0, 30_000],
    ]);
    await book("2025-11-01", final.id, [
      [a.forderungen, 70_000, 0],
      [a.erloese[1900], 0, 70_000],
    ]);
    await book("2025-10-02", old.id, [
      [a.forderungen, 50_000, 0],
      [a.erloese[1900], 0, 50_000],
    ]);
    expect(await receivables(2025)).toMatchObject({ betrag: 150_000, vorschlag: 80_000 });
  });
});
