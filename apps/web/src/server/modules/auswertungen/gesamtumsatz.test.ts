import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { taxDetails, turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

describe.skipIf(!testDatabaseUrl)("Gesamtumsatz nach vereinnahmten Nettoentgelten (Postgres)", () => {
  let sql: postgres.Sql;
  let read: typeof import("./gesamtumsatz.ts");
  let f: Awaited<ReturnType<typeof turnoverFixtures>>;
  beforeAll(async () => {
    sql = await setupTestDb();
    read = await import("./gesamtumsatz.ts");
  }, 30_000);
  beforeEach(async () => {
    f = await turnoverFixtures(sql);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["ist", "SKR03"],
    ["soll", "SKR04"],
  ] as const)("liest Banknetto bei %s/%s am Zahlungstag auch vor der Rechnung", async (mode, chart) => {
    f = await turnoverFixtures(sql, mode, chart);
    const invoice = await f.invoice();
    await f.allocate(await f.transaction(11_900), invoice, 11_900);
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 10_000, complete: true });
    expect(result.items).toContainEqual(expect.objectContaining({ source: "bank", occurredOn: "2026-11-05", net: 10_000, basisSource: "derived" }));
  });
  it("zieht bestätigte Heilbehandlung und Unterricht ab, zählt KU-Einnahmen", async () => {
    for (const exemption of [{ number: "14", letter: "a" }, { number: "21" }]) {
      const invoice = await f.invoice("steuerfrei", 60_000, 0, taxDetails({ exemption }));
      await f.allocate(await f.transaction(60_000), invoice, 60_000);
    }
    const invoice = await f.invoice("kleinunternehmer", 5_000, 0);
    await f.allocate(await f.transaction(5_000), invoice, 5_000);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 5_000, complete: true });
  });
  it("behält unstrukturierte Befreiung und ausländischen Leistungsort sichtbar ungeklärt", async () => {
    for (const treatment of ["steuerfrei", "drittland"] as const) {
      const invoice = await f.invoice(treatment, 12_345, 0);
      await f.allocate(await f.transaction(12_345), invoice, 12_345);
    }
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items.filter((i) => i.decision === "unknown")).toHaveLength(2);
  });
  it("verwendet gespeicherte kumulative Nettoanteile und prüft deren Rechnungs-ID", async () => {
    const invoice = await f.invoice();
    const other = await f.invoice();
    for (const [amount, base, tax] of [
      [3967, 3334, 633],
      [3967, 3333, 634],
      [3966, 3333, 633],
    ]) {
      await f.allocate(await f.transaction(amount!), invoice, amount!, {
        tax_shares: JSON.stringify([{ rate: 1900, base, tax }]),
        tax_shares_invoice_id: invoice,
      });
    }
    await f.allocate(await f.transaction(1190), other, 1190, {
      tax_shares: JSON.stringify([{ rate: 1900, base: 1189, tax: 1 }]),
      tax_shares_invoice_id: invoice,
    });
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 11_000, complete: true });
    expect(result.items.filter((i) => i.basisSource === "stored")).toHaveLength(3);
  });
  it("ordnet Anzahlungen dem Eingangsjahr zu und zählt Schlussrechnung und Ausbuchung nicht", async () => {
    const invoice = await f.invoice("kleinunternehmer", 100_000, 0);
    await sql`update invoices set variant = 'abschlag', advance_type = 'anzahlung', advance_accounting = 'deferred' where id = ${invoice}`;
    await f.allocate(await f.transaction(30_000, "2026-12-15"), invoice, 30_000);
    await f.allocate(await f.transaction(70_000, "2027-01-15"), invoice, 70_000);
    await f.invoice("kleinunternehmer", 100_000, 0);
    await sql`insert into write_offs (invoice_id, date, amount, kind) values (${invoice}, '2026-12-20', 100, 'forderungsausfall')`;
    expect((await read.gesamtumsatzForYear(2026)).included).toBe(30_000);
    expect((await read.gesamtumsatzForYear(2027)).included).toBe(70_000);
  });
  it("hebt alte Bankzuordnungen ohne falsche Erstattung auf und zeigt den offenen Eingang", async () => {
    const invoice = await f.invoice("steuerfrei", 100, 0);
    const transaction = await f.transaction(100);
    const original = await f.allocate(transaction, invoice, 100);
    await f.allocate(transaction, invoice, -100, { reverses_id: original });
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items.filter((i) => i.decision === "unknown")).toHaveLength(1);
    const next = await f.invoice("kleinunternehmer", 100, 0);
    await f.allocate(transaction, next, 100);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 100, complete: true });
  });
  it("behält den Zufluss im alten Jahr trotz späterer Aufhebung und mindert erst eine echte Rückzahlung", async () => {
    const originalInvoice = await f.invoice("kleinunternehmer", 10_000, 0);
    const transaction = await f.transaction(10_000, "2026-12-30");
    const original = await f.allocate(transaction, originalInvoice, 10_000);
    await f.allocate(transaction, originalInvoice, -10_000, { reverses_id: original, date: "2027-01-05" });
    const invoice = await f.invoice("kleinunternehmer", 10_000, 0);
    await f.allocate(transaction, invoice, 10_000);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 10_000, complete: true });
    expect(await read.gesamtumsatzForYear(2027)).toMatchObject({ included: 0, complete: true });
    await f.allocate(await f.transaction(-2_000, "2027-01-06"), invoice, -2_000);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 10_000, complete: true });
    const nextYear = await read.gesamtumsatzForYear(2027);
    expect(nextYear).toMatchObject({ included: -2_000, complete: true });
    expect(nextYear.items.filter((item) => item.decision === "included")).toEqual([
      expect.objectContaining({ source: "bank", occurredOn: "2027-01-06", net: -2_000 }),
    ]);
  });
  it("liest echte negative Bankerstattung und Kassenstorno an ihrem eigenen Tag", async () => {
    const invoice = await f.invoice("kleinunternehmer", 10_000, 0);
    await f.allocate(await f.transaction(10_000), invoice, 10_000);
    await f.allocate(await f.transaction(-2_000, "2026-11-20"), invoice, -2_000);
    const cash = await f.cash(1_000, "2025-12-20");
    await f.cash(-1_000, "2026-01-05", { reverses_id: cash });
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 7_000, complete: true });
  });
  it("erfasst direkte Erlöse und Bareinnahmen, aber Einlage und Darlehen nicht", async () => {
    const transaction = await f.transaction(11_900);
    await sql`insert into allocations (transaction_id, kind, amount, category, tax_rate) values (${transaction}, 'kategorie', 11900, 'erloese', 1900)`;
    await f.cash(1_000, "2026-11-01");
    await f.cash(50_000, "2026-11-01", { kind: "einlage", tax_treatment: null, tax_rate: null });
    await sql`insert into allocations (transaction_id, kind, amount) values (${await f.transaction(20_000)}, 'privat', 20000)`;
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 11_000, complete: true });
  });
  it("zeigt nicht zugeordnete Eingänge und Ausgänge ohne Nettoerfindung", async () => {
    await f.transaction(12_345);
    await f.transaction(-200);
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.net === null && i.decision === "unknown")).toBe(true);
  });
  it("schließt Anlageverkäufe nur anhand expliziter Metadaten aus", async () => {
    const invoice = await f.invoice("regulaer", 10_000, 1_900, taxDetails({ assetDisposal: true }));
    await f.allocate(await f.transaction(11_900), invoice, 11_900);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: true });
  });
  it("zählt denselben Bank-/Kassenzufluss nicht nochmals aus Journalquellen", async () => {
    const invoice = await f.invoice();
    const allocation = await f.allocate(await f.transaction(11_900), invoice, 11_900);
    for (const [sourceType, sourceId] of [
      ["allocation", allocation],
      ["invoice", invoice],
    ] as const) {
      await f.journal(sourceType, sourceId);
    }
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 10_000, complete: true });
  });
  it("meldet einen historischen Bezahltstatus ohne Zahlungsbeleg mit unbekanntem Betrag und Datum", async () => {
    await f.legacy("paid", null);
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items).toContainEqual(
      expect.objectContaining({ source: "legacy", occurredOn: null, net: null, basisSource: "unknown", decision: "unknown" }),
    );
  });
  it("nutzt bei Zinsen eine ausdrücklich festgestellte Vorschrift und Hilfsumsatzeinordnung", async () => {
    const transaction = await f.transaction(2_500);
    await sql`insert into allocations (transaction_id, kind, amount, tax_details)
      values (${transaction}, 'zinsertrag', 2500, ${JSON.stringify(taxDetails({ exemption: { number: "8", letter: "a" }, ancillary: false }))}::jsonb)`;
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 2_500, complete: true });
  });
  it("erhält bei alten Teilzahlungen ohne Snapshot über den Jahreswechsel den Netto-Centrest", async () => {
    const invoice = await f.invoice();
    await f.allocate(await f.transaction(3_967, "2025-12-30"), invoice, 3_967);
    await f.allocate(await f.transaction(3_967, "2026-01-05"), invoice, 3_967);
    await f.allocate(await f.transaction(3_966, "2026-02-05"), invoice, 3_966);
    expect((await read.gesamtumsatzForYear(2025)).included).toBe(3_334);
    expect((await read.gesamtumsatzForYear(2026)).included).toBe(6_666);
  });
});
