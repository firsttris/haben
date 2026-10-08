import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

const IBAN_A = "DE12500105170648489890";
const IBAN_B = "DE02120300000000202051";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tx(ref: string, date: string, amount: string, indicator: "CRDT" | "DBIT", purpose: string) {
  return {
    entry_reference: ref,
    transaction_amount: { currency: "EUR", amount },
    credit_debit_indicator: indicator,
    status: "BOOK",
    booking_date: date,
    value_date: date,
    debtor: { name: "Muster GmbH" },
    debtor_account: { iban: "DE89370400440532013000" },
    creditor: { name: "Telekom" },
    remittance_information: [purpose],
  };
}

/** Nachgebaute Enable-Banking-API mit zwei Konten und einer Kreditkarte ohne IBAN */
function fakeApi() {
  const calls: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];
  const state = { failUntilFallback: false, expired: false, sessions: 0 };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (state.expired && url.pathname.startsWith("/accounts/")) return json({ message: "Session expired" }, 401);
    if (url.pathname === "/aspsps") return json({ aspsps: [{ name: "Testbank", country: "DE", maximum_consent_validity: 90 * 86400, psu_types: ["business", "personal"] }] });
    if (url.pathname === "/auth") return json({ url: "https://bank.example/login", authorization_id: "a1" });
    if (url.pathname === "/sessions" && method === "POST") {
      state.sessions++;
      return json({
        session_id: `sess-${state.sessions}`,
        access: { valid_until: "2026-12-31T00:00:00Z" },
        accounts: [
          { uid: `uid-a-${state.sessions}`, account_id: { iban: IBAN_A }, name: "Geschäftskonto", currency: "EUR" },
          { uid: `uid-b-${state.sessions}`, account_id: { iban: IBAN_B }, name: "Tagesgeld", currency: "EUR" },
          { uid: "card", account_id: {}, name: "Kreditkarte", currency: "EUR" },
        ],
      });
    }
    if (url.pathname.startsWith("/sessions/") && method === "DELETE") return new Response(null, { status: 204 });
    const match = /^\/accounts\/([^/]+)\/(transactions|balances)$/.exec(url.pathname);
    if (match?.[2] === "balances") return json({ balances: [{ balance_amount: { currency: "EUR", amount: "1500.00" }, balance_type: "CLBD", reference_date: "2026-10-01" }] });
    if (match?.[2] === "transactions") {
      const from = url.searchParams.get("date_from")!;
      if (match[1]!.startsWith("uid-b") && state.failUntilFallback && from.endsWith("-01-01")) return json({ message: "Wrong transactions period requested" }, 422);
      const all = match[1]!.startsWith("uid-a")
        ? [tx("a1", "2026-09-05", "100.00", "CRDT", "Altbestand"), tx("a2", "2026-09-20", "49.99", "DBIT", "Telefon 9/2026"), tx("a3", "2026-09-28", "200.00", "CRDT", "RE-1")]
        : [tx("b1", "2026-09-30", "10.00", "CRDT", "Zinsen")];
      return json({ transactions: all.filter((t) => t.booking_date >= from), continuation_key: null });
    }
    return json({ message: "unbekannt" }, 404);
  }) as typeof fetch;
  return { fetchFn, calls, state };
}

describe.skipIf(!testDatabaseUrl)("Automatischer Kontoabruf (Postgres)", () => {
  let sync: typeof import("./bank-sync.ts");
  let bank: typeof import("./bank.ts");
  let db: typeof import("./db/index.ts");
  let sql: postgres.Sql;
  const api = fakeApi();
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    Object.assign(process.env, { ENABLE_BANKING_APP_ID: "app-1", ENABLE_BANKING_KEY: privateKey.replace(/\n/g, "\\n") });
    sync = await import("./bank-sync.ts");
    bank = await import("./bank.ts");
    db = await import("./db/index.ts");
    const { EnableBankingClient } = await import("@haben/import");
    sync.setEnableBankingClientFactory((o) => new EnableBankingClient({ ...o, fetch: api.fetchFn }));

    // Konto A wurde vorher per CSV importiert, bis zum 05.09.
    await db.db.transaction((t) =>
      bank.storeStatement(
        t,
        {
          format: "dkb-csv",
          accountIban: IBAN_A,
          accountName: "DKB Business",
          currency: "EUR",
          transactions: [{ bookingDate: "2026-09-05", amount: 10000, currency: "EUR", counterpartyName: "Muster GmbH", purpose: "ALTBESTAND (CSV)", index: 0 }],
          warnings: [],
        },
        { filename: "umsaetze.csv", sha256: "x" },
        null,
      ),
    );
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function connect(code = "code-1") {
    const { url } = await sync.startConnection(actor, { aspspName: "Testbank", country: "DE", psuType: "business" });
    expect(url).toBe("https://bank.example/login");
    const auth = api.calls.findLast((c) => c.path === "/auth")!.body as { state: string; redirect_url: string; psu_type: string };
    expect(auth.redirect_url).toBe("http://localhost:3000/api/bank/callback");
    expect(auth.psu_type).toBe("business");
    return sync.completeConnection(actor, { state: auth.state, code });
  }

  it("verbindet die Bank, legt fehlende Konten an und holt nur Umsätze nach dem letzten CSV-Import", async () => {
    api.state.failUntilFallback = true;
    const result = await connect();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Testbank verbunden, 3 neue Umsätze.");
    expect(result.message).toContain("1 Konten ohne IBAN");

    const txCalls = api.calls.filter((c) => c.path.endsWith("/transactions"));
    expect(txCalls[0]!.query.get("date_from")).toBe("2026-09-06");
    // Konto B: ab Jahresbeginn abgelehnt, dann die letzten 89 Tage
    expect(txCalls[1]!.query.get("date_from")).toMatch(/-01-01$/);
    expect(txCalls[2]!.query.get("date_from")).not.toMatch(/-01-01$/);

    const accounts = await db.db.select().from(db.schema.bankAccounts);
    expect(accounts.map((a) => [a.iban, a.name]).sort()).toEqual([
      [IBAN_B, "Tagesgeld"],
      [IBAN_A, "DKB Business"],
    ].sort());
    const rows = await sql`select purpose, amount from bank_transactions order by booking_date`;
    expect(rows.map((r) => r.purpose)).toEqual(["ALTBESTAND (CSV)", "Telefon 9/2026", "RE-1", "Zinsen"]);
    const imports = await sql`select format, closing_balance from bank_imports where format = 'enablebanking'`;
    expect(imports).toHaveLength(2);
    expect(imports[0]!.closing_balance).toBe(150000);

    const [connection] = await sync.listConnections();
    expect(connection).toMatchObject({ aspspName: "Testbank", status: "aktiv", lastError: null, psuType: "business" });
    expect(connection!.accounts.map((a) => a.syncedTo)).toEqual([expect.any(String), expect.any(String)]);
    const [secret] = await sql`select ciphertext from bank_connections`;
    expect(Buffer.from(secret!.ciphertext).toString("utf8")).not.toContain("sess-1");
  });

  it("überlappt Folgeabrufe um sieben Tage und überspringt Bekanntes", async () => {
    const [connection] = await sync.listConnections();
    api.calls.length = 0;
    const result = await sync.syncConnection(actor, connection!.id, "2026-10-09");
    expect(result).toMatchObject({ added: 0, error: null });
    const syncedTo = connection!.accounts[0]!.syncedTo!;
    const expected = new Date(Date.parse(`${syncedTo}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    expect(api.calls.find((c) => c.path.endsWith("/transactions"))!.query.get("date_from")).toBe(expected);
    const [after] = await sync.listConnections();
    expect(after!.accounts.map((a) => a.syncedTo)).toEqual(["2026-10-09", "2026-10-09"]);
  });

  it("ruft im Hintergrund höchstens einmal am Tag ab", async () => {
    api.calls.length = 0;
    expect(await sync.runDueBankSyncs(new Date())).toEqual({ synced: 0, added: 0, errors: [] });
    const later = new Date(Date.now() + 21 * 60 * 60 * 1000);
    const result = await sync.runDueBankSyncs(later);
    expect(result.synced).toBe(1);
    expect(api.calls.filter((c) => c.path.endsWith("/transactions"))).toHaveLength(2);
  });

  it("markiert die Verbindung als abgelaufen, wenn die Bank den Zugriff ablehnt", async () => {
    const [connection] = await sync.listConnections();
    api.state.expired = true;
    const result = await sync.syncConnection(actor, connection!.id);
    api.state.expired = false;
    expect(result.error).toMatch(/Zugriff abgelehnt: Session expired/);
    const [after] = await sync.listConnections();
    expect(after!.status).toBe("abgelaufen");
    await expect(sync.syncConnection(actor, connection!.id)).rejects.toThrow(/nicht aktiv/);
  });

  it("löst beim Erneuern die alte Zustimmung ab und übernimmt den Abrufstand", async () => {
    const [old] = await sync.listConnections();
    api.calls.length = 0;
    const result = await connect("code-2");
    expect(result.ok).toBe(true);
    const connections = await sync.listConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]!.id).not.toBe(old!.id);
    expect(connections[0]!.accounts.map((a) => a.uid)).toEqual(["uid-a-2", "uid-b-2"]);
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/sessions/sess-1")).toBe(true);
    // Abruf setzt beim alten Stand an, nicht beim Jahresbeginn
    const resume = new Date(Date.parse(`${old!.accounts[0]!.syncedTo}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    expect(api.calls.filter((c) => c.path.endsWith("/transactions")).map((c) => c.query.get("date_from"))).toEqual([resume, resume]);
  });

  it("merkt sich eine abgelehnte Freigabe", async () => {
    await sync.startConnection(actor, { aspspName: "Testbank", country: "DE", psuType: "personal" });
    const auth = api.calls.findLast((c) => c.path === "/auth")!.body as { state: string };
    const result = await sync.completeConnection(actor, { state: auth.state, error: "access_denied", errorDescription: "Abgebrochen" });
    expect(result).toMatchObject({ ok: false, message: "Abgebrochen" });
    await expect(sync.completeConnection(actor, { state: auth.state, code: "x" })).rejects.toThrow(/Unbekannte/);
    expect((await sync.listConnections()).map((c) => c.status).sort()).toEqual(["aktiv", "fehler"]);
  });

  it("lehnt eine Rückleitung nach mehr als einer Stunde ab", async () => {
    await sync.startConnection(actor, { aspspName: "Testbank", country: "DE", psuType: "personal" });
    const auth = api.calls.findLast((c) => c.path === "/auth")!.body as { state: string };
    await sql`update bank_connections set created_at = now() - interval '2 hours' where state = ${auth.state}`;
    await expect(sync.completeConnection(actor, { state: auth.state, code: "x" })).rejects.toThrow(/abgelaufene/);
    await sql`delete from bank_connections where status = 'wartet'`;
  });

  it("trennt eine Verbindung, die Umsätze bleiben", async () => {
    for (const c of await sync.listConnections()) await sync.removeConnection(actor, c.id);
    expect(await sync.listConnections()).toEqual([]);
    const [count] = await sql`select count(*)::int as n from bank_transactions`;
    expect(count!.n).toBe(4);
    const audit = await sql`select action, new_value from audit_log where table_name = 'bank_connections' and action = 'INSERT' limit 1`;
    expect(audit[0]!.new_value).not.toHaveProperty("ciphertext");
  });
});
