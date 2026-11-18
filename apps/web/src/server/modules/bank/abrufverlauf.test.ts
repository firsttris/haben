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

/*
 * Abruf über Enable Banking über mehrere Tage, mit nachgebauter API statt E2E (Browser und Ports der E2E-Läufe fehlen
 * lokal): Verbinden, Abruf, Wiederholung ohne Dublette, stornierter Umsatz, Konflikt mit Meldung an der Verbindung.
 */
describe.skipIf(!testDatabaseUrl)("Abrufverlauf über mehrere Tage, #306 (Postgres)", () => {
  let sync: typeof import("./bank-sync.ts");
  let sql: postgres.Sql;
  const t0 = today();
  let umsaetze = [buchung("x1", tag(t0, -10), "10.00"), buchung("x2", tag(t0, -3), "20.00")];

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

  const betraege = async () => (await sql`select amount from bank_transactions order by booking_date, amount`).map((r) => r.amount);
  const stand = async () => (await sql`select max(checkpoint)::text as c from import_batches`)[0]!.c;

  it("verbindet, ruft ab, wiederholt ohne Dublette, übergeht Storniertes und hält das Konto bei einem Konflikt an", async () => {
    // Verbinden mit der echten Uhr: Die Datenbank stempelt die Freigabe mit ihrer Zeit (created_at), und completeConnection
    // prüft deren Alter mit Date.now(); eine Uhr auf 12:00 UTC ließe sie vor etwa 11:50 UTC als abgelaufen gelten
    vi.useRealTimers();
    await sync.startConnection("test", { aspspName: "Testbank", country: "DE", psuType: "business", fetchFrom: tag(t0, -20) });
    // created_at setzt die Datenbank mit echter Zeit, die Gültigkeit der Rückleitung prüft completeConnection mit der
    // Testuhr; ohne Angleichen wäre der Test je nach Tageszeit rot
    await sql`update bank_connections set created_at = ${new Date().toISOString()}::timestamptz where status = 'wartet'`;
    const [pending] = await sql`select state from bank_connections where status = 'wartet'`;
    expect(await sync.completeConnection("test", { state: pending!.state, code: "c" })).toMatchObject({ ok: true });
    const [connection] = await sync.listConnections();
    expect(await betraege()).toEqual([-1000, -2000]);

    // Derselbe Tag noch einmal: nichts neu
    expect(await sync.syncConnection("test", connection!.id, t0)).toMatchObject({ added: 0, error: null });
    expect(await betraege()).toEqual([-1000, -2000]);

    // Nächster Tag: ein neuer Umsatz und ein stornierter; der Stand rückt bis heute vor
    umsaetze = [...umsaetze, buchung("x3", tag(t0, 1), "30.00"), buchung("x4", tag(t0, 1), "40.00", "CNCL")];
    amTag(tag(t0, 1));
    expect(await sync.syncConnection("test", connection!.id, tag(t0, 1))).toMatchObject({ added: 1, error: null });
    expect(await betraege()).toEqual([-1000, -2000, -3000]);
    expect(await stand()).toBe(tag(t0, 1));

    // Die Bank ändert einen übernommenen Umsatz: nichts gespeichert, Meldung an der Verbindung und im Importprotokoll
    umsaetze = umsaetze.map((t) => (t.entry_reference === "x2" ? buchung("x2", tag(t0, -3), "21.00") : t));
    amTag(tag(t0, 2));
    const konflikt = await sync.syncConnection("test", connection!.id, tag(t0, 2));
    expect(konflikt.error).toMatch(/Konflikt mit schon übernommenen Umsätzen: x2\/main: Betrag -20,00\s€ → -21,00\s€/);
    const [nachher] = await sync.listConnections();
    expect(nachher!.lastError).toMatch(/Konflikt/);
    expect(nachher!.status).toBe("aktiv");
    expect(await betraege()).toEqual([-1000, -2000, -3000]);
    const [protokoll] = await sql<{ warnings: string[] }[]>`select warnings from bank_imports order by created_at desc limit 1`;
    expect(protokoll!.warnings).toEqual([expect.stringMatching(/Konflikt/)]);
  });
});
