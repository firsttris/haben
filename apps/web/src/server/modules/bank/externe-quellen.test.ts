import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * REST-Import (#306, Schritt 4): Ein Dienst liefert über die API nur in Quellen, die der Nutzer am Konto freigegeben hat.
 * Haben baut den Auszug selbst aus der Lieferung und speichert sie wie einen Abruf (storeBatch). Erfundene Daten.
 */

const lieferung = (over: { key?: string; movements?: unknown[]; provider?: string; konto?: string; from?: string } = {}) => ({
  contractVersion: 1,
  provider: over.provider ?? "marktplatz-dienst",
  externalAccountId: over.konto ?? "verkaeufer-1",
  idempotencyKey: over.key ?? "lieferung-1",
  fetchedAt: "2026-10-31T23:00:00+01:00",
  coverage: { from: over.from ?? "2026-10-01", to: "2026-10-31" },
  part: { fetchId: over.key ?? "lieferung-1", index: 0, last: true },
  movements: over.movements ?? [
    {
      sourceEventId: "SALE-1",
      component: "main",
      kind: "payment",
      bookingDate: "2026-10-03",
      amount: 4999,
      currency: "EUR",
      counterpartyName: "Erika Beispiel",
      purpose: "Bestellung 01-1",
      references: { orderId: "01-1", payoutId: "PO-1" },
    },
    {
      sourceEventId: "SALE-1",
      component: "fee",
      kind: "payment",
      bookingDate: "2026-10-03",
      amount: -1006,
      currency: "EUR",
      purpose: "Gebühren zu Bestellung 01-1",
      references: { orderId: "01-1", payoutId: "PO-1" },
    },
    {
      sourceEventId: "PO-1",
      component: "main",
      kind: "payout",
      bookingDate: "2026-10-20",
      amount: -3993,
      currency: "EUR",
      purpose: "Auszahlung",
      references: { payoutId: "PO-1" },
    },
  ],
  balances: [{ date: "2026-10-31", amount: 0, currency: "EUR" }],
});

describe.skipIf(!testDatabaseUrl)("Externe Quellen und REST-Import (Postgres)", () => {
  let quellen: typeof import("./externe-quellen.ts");
  let sql: postgres.Sql;
  let psp: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    quellen = await import("./externe-quellen.ts");
    [{ id: psp }] = (await sql`insert into bank_accounts (name, purpose, provider) values ('Marktplatz', 'zahlungsdienstleister', 'sonstige')
      returning id`) as unknown as [{ id: string }];
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const umsaetze = (konto: string) =>
    sql`select amount, purpose, bank_reference from bank_transactions where bank_account_id = ${konto} order by booking_date, amount desc`;

  it("nimmt keine Lieferung an, solange die Quelle nicht freigegeben ist", async () => {
    expect(await quellen.importExternalBatch("api:t:Dienst", lieferung())).toMatchObject({ status: "not_found" });
    expect(await umsaetze(psp)).toEqual([]);
  });

  it("gibt eine Quelle am Konto frei, mit Stichtag; interne Anbieter und eine zweite Quelle am Konto nicht", async () => {
    await expect(quellen.addExternalSource("test", { accountId: psp, provider: "etsy", externalAccountId: "x" })).rejects.toThrow(
      /Etsy|intern|eigene Anbindung/,
    );
    const quelle = await quellen.addExternalSource("test", {
      accountId: psp,
      provider: "marktplatz-dienst",
      externalAccountId: "verkaeufer-1",
      cutoverDate: "2026-10-01",
    });
    expect(quelle).toMatchObject({ provider: "marktplatz-dienst", externalAccountId: "verkaeufer-1", accountKind: "psp", cutoverDate: "2026-10-01" });
    await expect(quellen.addExternalSource("test", { accountId: psp, provider: "anderer-dienst", externalAccountId: "y" })).rejects.toThrow(
      /schon eine Quelle/,
    );
    expect(await quellen.externalSources()).toMatchObject([
      {
        accountId: psp,
        accountName: "Marktplatz",
        provider: "marktplatz-dienst",
        externalAccountId: "verkaeufer-1",
        cutoverDate: "2026-10-01",
        checkpoint: null,
      },
    ]);
  });

  it("legt aus einer Lieferung Zahlung, Gebühr und Auszahlung an und rückt den Abrufstand vor", async () => {
    const r = await quellen.importExternalBatch("api:t:Dienst", lieferung());
    expect(r).toMatchObject({ status: "ok", result: { added: 3, replay: false, checkpoint: "2026-10-31", complete: true } });
    expect(await umsaetze(psp)).toEqual([
      { amount: 4999, purpose: "Bestellung 01-1", bank_reference: "SALE-1" },
      { amount: -1006, purpose: "Gebühr · Gebühren zu Bestellung 01-1", bank_reference: "SALE-1#fee" },
      { amount: -3993, purpose: "Auszahlung PO-1 · Auszahlung", bank_reference: "payout-PO-1|PO-1" },
    ]);
    const [protokoll] = await sql`select format from bank_imports where bank_account_id = ${psp} order by created_at desc limit 1`;
    expect(protokoll!.format).toBe("importvertrag-psp");
    // Die Referenzen der Lieferung bleiben an der Bewegung (import_movements.refs, #1486)
    const [zahlung] = await sql`select refs from import_movements where source_event_id = 'SALE-1' and component = 'main'`;
    expect(zahlung!.refs).toEqual({ orderId: "01-1", payoutId: "PO-1" });
    expect(await quellen.externalSources()).toMatchObject([{ checkpoint: "2026-10-31", complete: true, openConflicts: 0 }]);
  });

  it("gibt dieselbe Lieferung nach verlorener Antwort noch einmal zurück, ohne etwas anzulegen", async () => {
    expect(await quellen.importExternalBatch("api:t:Dienst", lieferung())).toMatchObject({ status: "ok", result: { added: 0, replay: true } });
    expect(await umsaetze(psp)).toHaveLength(3);
  });

  it("meldet einen anderen Inhalt unter demselben Schlüssel und einen geänderten Betrag als Konflikt", async () => {
    expect(await quellen.importExternalBatch("api:t:Dienst", lieferung({ movements: [] }))).toMatchObject({ status: "conflict" });
    const geaendert = lieferung({ key: "lieferung-2" });
    (geaendert.movements[0] as { amount: number }).amount = 5099;
    const r = await quellen.importExternalBatch("api:t:Dienst", geaendert);
    expect(r).toMatchObject({ status: "conflict", conflicts: [{ sourceEventId: "SALE-1", component: "main" }] });
    expect(await umsaetze(psp)).toHaveLength(3);
    expect(await quellen.externalSources()).toMatchObject([{ openConflicts: 1 }]);
  });

  it("nimmt bei offenem Konflikt auch neue Ereignisse nicht an, nach dem Klären wieder", async () => {
    const neu = {
      sourceEventId: "SALE-9",
      component: "main",
      kind: "payment",
      bookingDate: "2026-10-25",
      amount: 1999,
      currency: "EUR",
      purpose: "Bestellung 01-9",
      references: { orderId: "01-9" },
    };
    const gesperrt = await quellen.importExternalBatch("api:t:Dienst", lieferung({ key: "lieferung-3", movements: [neu] }));
    expect(gesperrt).toMatchObject({ status: "conflict", message: expect.stringMatching(/Konflikt klären/) });
    expect(await umsaetze(psp)).toHaveLength(3);

    const konflikt = await import("./import-konflikt.ts");
    const [offen] = await konflikt.openConflicts();
    await konflikt.resolveConflict("test", { conflictId: offen!.id, decision: "keep" });
    const danach = await quellen.importExternalBatch("api:t:Dienst", lieferung({ key: "lieferung-4", movements: [neu] }));
    expect(danach).toMatchObject({ status: "ok", result: { added: 1 } });
    expect(await umsaetze(psp)).toHaveLength(4);
  });

  it("nimmt keine Quelle eines Anbieters mit eigener Anbindung in Haben an, auch nicht PayPal (#1531)", async () => {
    const [konto] = await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, provider) values ('PayPal', 'zahlungsdienstleister', 'paypal')
      returning id`;
    await expect(quellen.addExternalSource("test", { accountId: konto!.id, provider: "paypal", externalAccountId: "haendler-1" })).rejects.toThrow(
      /eigene Anbindung/,
    );
    expect(await quellen.importExternalBatch("api:t:Dienst", lieferung({ provider: "paypal", konto: "haendler-1", key: "pp-1" }))).toMatchObject({
      status: "not_found",
    });
  });

  it("liefert von außen nicht in die Quelle des Stripe-Abrufs (#1237)", async () => {
    const [konto] = await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, provider) values ('Stripe', 'zahlungsdienstleister', 'stripe')
      returning id`;
    // So legt der Stripe-Abruf seine Bindung an (stripe/import.ts): Anbieter stripe, Kennung acct_…
    await sql`insert into import_sources (bank_account_id, provider, external_account_id, account_kind, cutover_date)
      values (${konto!.id}, 'stripe', 'acct_beispiel', 'psp', '2026-10-01')`;
    expect(await quellen.importExternalBatch("api:t:Dienst", lieferung({ provider: "stripe", konto: "acct_beispiel", key: "st-1" }))).toMatchObject({
      status: "not_found",
    });
    expect(await umsaetze(konto!.id)).toHaveLength(0);
    expect((await quellen.externalSources()).map((q) => q.provider)).not.toContain("stripe");
  });

  it("zählt ein Konto mit Bankabruf ohne Stichtag (Bindung aus v0.11.0) als gebunden", async () => {
    const [konto] = await sql<{ id: string }[]>`insert into bank_accounts (name, iban) values ('Giro', 'DE89370400440532013000') returning id`;
    await sql`insert into import_sources (bank_account_id, provider, external_account_id, account_kind) values (${konto!.id}, 'enablebanking', 'hash-alt', 'bank')`;
    expect(await quellen.boundAccountIds()).toEqual(expect.arrayContaining([konto!.id, psp]));
    await expect(quellen.addExternalSource("test", { accountId: konto!.id, provider: "anderer-dienst", externalAccountId: "z" })).rejects.toThrow(
      /schon eine Quelle/,
    );
  });

  it("lehnt eine Lieferung ab, die gegen den Vertrag verstößt, und nennt den Grund", async () => {
    const r = await quellen.importExternalBatch("api:t:Dienst", { ...lieferung({ key: "kaputt" }), contractVersion: 2 });
    expect(r).toMatchObject({ status: "invalid", problems: [expect.stringMatching(/Vertragsversion 2/)] });
  });

  it("lehnt mehr als 1.000 Bewegungen in einer Lieferung ab", async () => {
    const viele = Array.from({ length: 1001 }, (_, i) => ({
      sourceEventId: `E-${i}`,
      component: "main",
      kind: "payment",
      bookingDate: "2026-10-05",
      amount: 100,
      currency: "EUR",
      references: {},
    }));
    expect(await quellen.importExternalBatch("api:t:Dienst", lieferung({ key: "viele", movements: viele }))).toMatchObject({ status: "too_large" });
  });

  it("übernimmt eine geänderte Gebühr nach dem Konflikt als Gebühr, wie der Import sie angelegt hätte", async () => {
    const geaendert = lieferung({ key: "lieferung-gebuehr" });
    (geaendert.movements[1] as { amount: number }).amount = -1106;
    const r = await quellen.importExternalBatch("api:t:Dienst", geaendert);
    expect(r).toMatchObject({ status: "conflict", conflicts: [{ sourceEventId: "SALE-1", component: "fee" }] });

    const konflikt = await import("./import-konflikt.ts");
    const [offen] = await konflikt.openConflicts();
    expect(offen!.delivered).toMatchObject({ amount: -1106, purpose: "Gebühr · Gebühren zu Bestellung 01-1" });
    const { transactionId } = await konflikt.resolveConflict("test", { conflictId: offen!.id, decision: "add" });
    const [weiterer] = await sql`select amount, purpose, bank_reference from bank_transactions where id = ${transactionId!}`;
    // Mit „Gebühr“ vorn erkennt die Sammelzuordnung sie, wie die Gebühr aus der ersten Lieferung
    expect(weiterer).toEqual({ amount: -1106, purpose: "Gebühr · Gebühren zu Bestellung 01-1", bank_reference: "SALE-1#fee" });
  });
});
