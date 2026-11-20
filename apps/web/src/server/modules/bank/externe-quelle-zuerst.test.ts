import { generateKeyPairSync } from "node:crypto";
import { statementFromBatch } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

/*
 * Ein Konto hat höchstens eine Quelle (#306, Schritt 4; docs/bank.md): Hat es schon eine externe Quelle, bekommt es keinen
 * Abruf in Haben dazu, weder beim Verbinden über Enable Banking noch beim Speichern des Zugangs zu PayPal, Stripe oder Etsy
 * noch beim ersten Abruf. FinTS steht in fints.test.ts. Erfundene Daten.
 */

const IBAN = "DE12500105170648489890";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Nachgebaute Enable-Banking-API: Freigabe und Sitzung mit einem Konto; abgerufen wird nichts */
const fakeEnableBanking = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname === "/aspsps") return json({ aspsps: [{ name: "Testbank", country: "DE", maximum_consent_validity: 90 * 86400, psu_types: ["business"] }] });
  if (url.pathname === "/auth") return json({ url: "https://bank.example/login", authorization_id: "a1" });
  if (url.pathname === "/sessions" && init?.method === "POST") {
    return json({
      session_id: "sess-1",
      access: { valid_until: "2026-12-31T00:00:00Z" },
      accounts: [{ uid: "uid-1", account_id: { iban: IBAN }, identification_hash: "hash-1", name: "Giro", currency: "EUR" }],
    });
  }
  if (url.pathname.startsWith("/accounts/")) return json({ transactions: [], balances: [], continuation_key: null });
  return json({ message: "unbekannt" }, 404);
}) as typeof fetch;

describe.skipIf(!testDatabaseUrl)("Abruf an einem Konto mit externer Quelle (Postgres)", () => {
  let sql: postgres.Sql;
  let quellen: typeof import("./externe-quellen.ts");
  let sync: typeof import("./bank-sync.ts");
  let importBatch: typeof import("./import-batch.ts");
  let db: typeof import("../../db/index.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    Object.assign(process.env, { ENABLE_BANKING_APP_ID: "app-1", ENABLE_BANKING_KEY: privateKey.replace(/\n/g, "\\n") });
    quellen = await import("./externe-quellen.ts");
    sync = await import("./bank-sync.ts");
    importBatch = await import("./import-batch.ts");
    db = await import("../../db/index.ts");
    const { EnableBankingClient } = await import("@haben/import");
    sync.setEnableBankingClientFactory((o) => new EnableBankingClient({ ...o, fetch: fakeEnableBanking }));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Konto mit externer Quelle, wie „Externe Quelle hinzufügen“ sie anlegt */
  async function mitExternerQuelle(konto: { name: string; iban?: string; provider?: string }) {
    const [row] = konto.iban
      ? await sql<{ id: string }[]>`insert into bank_accounts (name, iban) values (${konto.name}, ${konto.iban}) returning id`
      : await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, provider) values (${konto.name}, 'zahlungsdienstleister', ${konto.provider!})
          returning id`;
    await quellen.addExternalSource("test", { accountId: row!.id, provider: "eigener-dienst", externalAccountId: `kennung-${row!.id}` });
    return row!.id;
  }
  const quellenAm = async (konto: string) => (await sql`select provider from import_sources where bank_account_id = ${konto}`).map((q) => q.provider);

  it("verbindet über Enable Banking kein Konto, das schon eine externe Quelle hat", async () => {
    const konto = await mitExternerQuelle({ name: "Giro", iban: IBAN });
    await sync.startConnection("test", { aspspName: "Testbank", country: "DE", psuType: "business" });
    const [{ state } = { state: "" }] = await sql<{ state: string }[]>`select state from bank_connections where state is not null`;
    await expect(sync.completeConnection("test", { state, code: "code-1" })).rejects.toThrow(/schon über die Schnittstelle \(eigener-dienst\)/);
    expect(await sql`select accounts from bank_connections where jsonb_array_length(accounts) > 0`).toHaveLength(0);
    expect(await quellenAm(konto)).toEqual(["eigener-dienst"]);
  });

  it("legt beim Abruf eines Zahlungsdienstleisters keine zweite Quelle an einem Konto mit externer Quelle an", async () => {
    const konto = await mitExternerQuelle({ name: "PayPal", provider: "paypal" });
    const batch = {
      contractVersion: 1,
      provider: "paypal",
      externalAccountId: "HAENDLER1",
      idempotencyKey: "pp-1",
      fetchedAt: `${today()}T23:00:00+01:00`,
      coverage: { from: today(), to: today() },
      part: { fetchId: "pp-1", index: 0, last: true },
      movements: [],
      balances: [],
      unsupported: [],
    };
    const { statement, eventOf } = statementFromBatch(batch, "psp");
    const input = {
      batch,
      binding: { provider: "paypal", externalAccountId: "HAENDLER1", accountKind: "psp" as const },
      statement,
      eventOf,
      source: { filename: "Abruf PayPal", sha256: "a".repeat(64) },
    };
    await expect(db.db.transaction((t) => importBatch.storeBatch(t, input, konto))).rejects.toThrow(/schon über die Schnittstelle/);
    expect(await quellenAm(konto)).toEqual(["eigener-dienst"]);
  });

  it("speichert den Zugang zu PayPal, Stripe oder Etsy nicht, wenn ihr Konto schon eine externe Quelle hat", async () => {
    const paypal = await import("../paypal/index.ts");
    const stripe = await import("../stripe/index.ts");
    const etsy = await import("../etsy/index.ts");
    paypal.setPayPalClientFactory(() => ({ accountId: async () => "HAENDLER2" }) as never);
    stripe.setStripeClientFactory(() => ({ accountId: async () => "acct_beispiel" }) as never);
    await mitExternerQuelle({ name: "Stripe", provider: "stripe" });
    await mitExternerQuelle({ name: "Etsy", provider: "etsy" });
    const tag = today();
    await expect(paypal.savePayPalConnection("test", { clientId: "client-1", clientSecret: "secret-1", fetchFrom: tag })).rejects.toThrow(
      /schon über die Schnittstelle/,
    );
    await expect(stripe.saveStripeConnection("test", { apiKey: "rk_live_beispiel123", fetchFrom: tag })).rejects.toThrow(/schon über die Schnittstelle/);
    await expect(etsy.saveEtsyConnection("test", { keystring: "abc", sharedSecret: "geheim", fetchFrom: tag.slice(0, 7) })).rejects.toThrow(
      /schon über die Schnittstelle/,
    );
    expect(await sql`select 1 from paypal_connections union all select 1 from stripe_connections union all select 1 from etsy_connections`).toHaveLength(0);
  });
});
