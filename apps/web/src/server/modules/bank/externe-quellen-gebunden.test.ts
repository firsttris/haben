import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ein Konto, das an einen Abruf in Haben gebunden ist, bekommt keine externe Quelle (#306, Schritt 4; docs/bank.md), auch
 * vor dem ersten Abruf, solange noch keine Quellenbindung in import_sources steht: Enable Banking ohne identification_hash,
 * FinTS ganz ohne Quellenbindung, Etsy, PayPal und Stripe zwischen Verbinden und erstem Abruf. Erfundene Daten.
 */

describe.skipIf(!testDatabaseUrl)("Externe Quelle an einem Konto mit Abruf (Postgres)", () => {
  let quellen: typeof import("./externe-quellen.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    quellen = await import("./externe-quellen.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const bankkonto = async (name: string, iban: string) =>
    (await sql<{ id: string }[]>`insert into bank_accounts (name, iban) values (${name}, ${iban}) returning id`)[0]!.id;
  const pspKonto = async (name: string, provider: string) =>
    (await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, provider) values (${name}, 'zahlungsdienstleister', ${provider}) returning id`)[0]!
      .id;
  const freigeben = (accountId: string, provider: string) =>
    quellen.addExternalSource("test", { accountId, provider, externalAccountId: `kennung-${accountId}` });

  it("Enable-Banking-Konto ohne identification_hash bekommt keine externe Quelle", async () => {
    const konto = await bankkonto("Giro EB", "DE89370400440532013000");
    const accounts = [{ uid: "u1", iban: "DE89370400440532013000", identificationHash: null, name: "Giro EB", bankAccountId: konto, syncedTo: "2026-09-30" }];
    await sql`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, accounts)
      values ('Bank', 'DE', 'business', 'aktiv', ${JSON.stringify(accounts)}::jsonb)`;
    await expect(freigeben(konto, "fremd-dienst")).rejects.toThrow(/nur aus einer/);
    expect(await quellen.boundAccountIds()).toContain(konto);
  });

  it("Enable-Banking-Konto vor dem ersten Abruf bekommt keine externe Quelle", async () => {
    const konto = await bankkonto("Giro EB neu", "DE75512108001245126199");
    const accounts = [{ uid: "u2", iban: "DE75512108001245126199", name: "Giro EB neu", bankAccountId: konto, syncedTo: null }];
    await sql`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, accounts)
      values ('Bank', 'DE', 'business', 'aktiv', ${JSON.stringify(accounts)}::jsonb)`;
    await expect(freigeben(konto, "fremd-dienst")).rejects.toThrow(/nur aus einer/);
  });

  it("FinTS-Konto bekommt keine externe Quelle", async () => {
    const konto = await bankkonto("Giro FinTS", "DE02120300000000202051");
    const accounts = [{ uid: "DE02120300000000202051", iban: "DE02120300000000202051", name: "Giro FinTS", bankAccountId: konto, syncedTo: "2026-09-30" }];
    await sql`insert into fints_connections (bank_name, bank_code, url, login, ciphertext, accounts)
      values ('Bank', '12030000', 'https://x', 'l', '\\x00', ${JSON.stringify(accounts)}::jsonb)`;
    await expect(freigeben(konto, "fremd-dienst")).rejects.toThrow(/nur aus einer/);
    expect(await quellen.boundAccountIds()).toContain(konto);
  });

  it("Konto des Etsy-Abrufs bekommt vor dem ersten Abruf keine externe Quelle, ohne verbundenen Shop schon", async () => {
    const konto = await pspKonto("Etsy", "etsy");
    await sql`insert into etsy_connections (keystring, shop_id, ciphertext, fetch_from, abruf_start) values ('k', '', '\\x00', '2026-10-01', '2026-10-01')`;
    // Getrennt (shop_id leer): kein Abruf, das Konto ist frei
    expect(await quellen.boundAccountIds()).not.toContain(konto);
    await sql`update etsy_connections set shop_id = '12345'`;
    await expect(freigeben(konto, "fremd-dienst")).rejects.toThrow(/nur aus einer/);
    expect(await quellen.boundAccountIds()).toContain(konto);
  });

  it("Konto des PayPal-Abrufs bekommt vor dem ersten Abruf keine externe Quelle, ein zweites PayPal-Konto schon", async () => {
    const konto = await pspKonto("PayPal", "paypal");
    const zweites = await pspKonto("PayPal privat", "paypal");
    await sql`insert into paypal_connections (account_id, ciphertext, fetch_from, abruf_start) values ('HAENDLER1', '\\x00', '2026-10-01', '2026-10-01')`;
    await expect(freigeben(konto, "fremd-dienst")).rejects.toThrow(/nur aus einer/);
    // Der Abruf schreibt nur in das älteste PayPal-Konto (paypal/import.ts)
    expect(await freigeben(zweites, "fremd-paypal")).toMatchObject({ bankAccountId: zweites });
  });

  it("Konto des Stripe-Abrufs bekommt vor dem ersten Abruf keine externe Quelle", async () => {
    const konto = await pspKonto("Stripe", "stripe");
    await sql`insert into stripe_connections (account_id, ciphertext, fetch_from, abruf_start) values ('acct_beispiel', '\\x00', '2026-10-01', '2026-10-01')`;
    await expect(freigeben(konto, "fremd-dienst")).rejects.toThrow(/nur aus einer/);
  });

  it("Konto eines Zahlungsdienstleisters ohne Abruf bekommt eine externe Quelle", async () => {
    const konto = await pspKonto("Stripe Zweitkonto", "stripe");
    expect(await freigeben(konto, "fremd-stripe")).toMatchObject({ bankAccountId: konto });
  });
});
