import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

const IBAN = "DE12500105170648489890";
/** Abruf an einem späteren Tag, mit passender Uhr (fetchedAt kommt aus new Date()) */
const amTag = (d: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${d}T12:00:00Z`) });
const tag = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const buchung = (ref: string, date: string, amount: string, status = "BOOK") => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: "DBIT",
  status,
  booking_date: date,
  value_date: date,
  creditor: { name: "Telekom" },
  remittance_information: [`Zahlung ${ref}`],
});

describe.skipIf(!testDatabaseUrl)("Stornierter Umsatz im Abruf, #306 (Postgres)", () => {
  let sync: typeof import("./bank-sync.ts");
  let sql: postgres.Sql;
  const t0 = today();
  const calls: URL[] = [];
  const umsaetze = [buchung("x1", tag(t0, -10), "10.00"), buchung("x2", tag(t0, -2), "20.00", "CNCL")];

  beforeAll(async () => {
    sql = await setupTestDb();
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    Object.assign(process.env, { ENABLE_BANKING_APP_ID: "app-1", ENABLE_BANKING_KEY: privateKey.replace(/\n/g, "\\n") });
    sync = await import("./bank-sync.ts");
    const { EnableBankingClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      const method = init?.method ?? "GET";
      if (url.pathname === "/aspsps")
        return json({ aspsps: [{ name: "Testbank", country: "DE", maximum_consent_validity: 365 * 86400, psu_types: ["business"] }] });
      if (url.pathname === "/auth") return json({ url: "https://bank.example/login", authorization_id: "a1" });
      if (url.pathname === "/sessions" && method === "POST")
        return json({
          session_id: "sess-1",
          access: { valid_until: "2027-12-31T00:00:00Z" },
          accounts: [{ uid: "uid-x", account_id: { iban: IBAN }, identification_hash: "hash-x", name: "Geschäftskonto", currency: "EUR" }],
        });
      if (url.pathname.endsWith("/balances")) return json({ balances: [] });
      if (url.pathname.endsWith("/transactions")) {
        const from = url.searchParams.get("date_from")!;
        const to = url.searchParams.get("date_to")!;
        // Wie manche Banken ohne frische Anmeldung (siehe syncConnection): höchstens 90 Tage zurück
        if (from < tag(to, -90)) return json({ message: "Wrong transactions period requested" }, 422);
        return json({ transactions: umsaetze.filter((t) => t.booking_date >= from && t.booking_date <= to), continuation_key: null });
      }
      return json({ message: "unbekannt" }, 404);
    }) as typeof fetch;
    sync.setEnableBankingClientFactory((o) => new EnableBankingClient({ ...o, fetch: fetchFn }));
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await sql?.end();
  });

  it("ein stornierter Umsatz (CNCL) hält den Abrufstand nicht für immer an", async () => {
    await sync.startConnection("test", { aspspName: "Testbank", country: "DE", psuType: "business", fetchFrom: tag(t0, -20) });
    const [pending] = await sql`select state from bank_connections where status = 'wartet'`;
    const result = await sync.completeConnection("test", { state: pending!.state, code: "c" });
    expect(result.ok).toBe(true);
    const [connection] = await sync.listConnections();

    // Die Bank liefert den stornierten Umsatz in jedem Abruf wieder mit; sonst ändert sich nichts
    for (const n of [30, 60]) {
      amTag(tag(t0, n));
      expect((await sync.syncConnection("test", connection!.id, tag(t0, n))).error).toBeNull();
    }
    amTag(tag(t0, 100));
    const spaeter = await sync.syncConnection("test", connection!.id, tag(t0, 100));
    const [after] = await sync.listConnections();
    expect({ error: spaeter.error, syncedTo: after!.accounts[0]!.syncedTo }).toEqual({ error: null, syncedTo: tag(t0, 100) });
  });
});
