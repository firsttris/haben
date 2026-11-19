import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

const IBAN_A = "DE12500105170648489890";
const IBAN_B = "DE02120300000000202051";
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

describe.skipIf(!testDatabaseUrl)("Abgelehnter Abruf in Kontoübersicht und Datenexport, #306 (Postgres)", () => {
  let sync: typeof import("./bank-sync.ts");
  let sql: postgres.Sql;
  const t0 = today();
  const umsaetze: Record<string, ReturnType<typeof buchung>[]> = { "uid-a": [buchung("a1", tag(t0, -5), "10.00")], "uid-b": [] };

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
          accounts: [
            { uid: "uid-a", account_id: { iban: IBAN_A }, identification_hash: "hash-a", name: "Konto A", currency: "EUR" },
            { uid: "uid-b", account_id: { iban: IBAN_B }, identification_hash: "hash-b", name: "Konto B", currency: "EUR" },
          ],
        });
      if (url.pathname.endsWith("/balances")) return json({ balances: [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "1234.56" } }] });
      if (url.pathname.endsWith("/transactions")) {
        const from = url.searchParams.get("date_from")!;
        const to = url.searchParams.get("date_to")!;
        // Wie manche Banken ohne frische Anmeldung (siehe syncConnection): höchstens 90 Tage zurück
        if (from < tag(to, -90)) return json({ message: "Wrong transactions period requested" }, 422);
        const uid = url.pathname.split("/")[2]!;
        return json({ transactions: umsaetze[uid]!.filter((t) => t.booking_date >= from && t.booking_date <= to), continuation_key: null });
      }
      return json({ message: "unbekannt" }, 404);
    }) as typeof fetch;
    sync.setEnableBankingClientFactory((o) => new EnableBankingClient({ ...o, fetch: fetchFn }));
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await sql?.end();
  });

  it("ein abgelehnter Abruf ändert Kontostand und Stand der letzten Lieferung in der Kontoübersicht nicht", async () => {
    await sync.startConnection("test", { aspspName: "Testbank", country: "DE", psuType: "business", fetchFrom: tag(t0, -20) });
    const [pending] = await sql`select state from bank_connections where status = 'wartet'`;
    expect((await sync.completeConnection("test", { state: pending!.state, code: "c" })).ok).toBe(true);
    const [connection] = await sync.listConnections();
    const { listAccounts } = await import("./index.ts");
    const vorher = (await listAccounts()).find((a) => a.iban === IBAN_A)!.lastImport;
    expect(vorher?.closingBalance).toBe(123456);

    umsaetze["uid-a"] = [buchung("a1", tag(t0, -5), "11.00")];
    amTag(tag(t0, 10));
    expect((await sync.syncConnection("test", connection!.id, tag(t0, 10))).error).toMatch(/Konflikt/);
    const nachher = (await listAccounts()).find((a) => a.iban === IBAN_A)!.lastImport;
    expect(nachher).toEqual(vorher);
  });
  it("der abgelehnte Abruf steht im Importprotokoll (bank/importe.csv im Datenexport), wie docs/bank.md sagt", async () => {
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'ist', 'SKR03') on conflict do nothing`;
    const [n] = await sql`select count(*)::int as n from bank_imports where warnings::text like '%Konflikt%'`;
    expect(n!.n).toBeGreaterThan(0);
    const exporter = await import("../archiv/export.ts");
    const { unzipSync, strFromU8 } = await import("fflate");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(Number(t0.slice(0, 4)), new Date())) chunks.push(chunk);
    const importe = strFromU8(unzipSync(Buffer.concat(chunks))["bank/importe.csv"]!);
    expect(importe).toContain("Konflikt mit schon übernommenen Umsätzen");
  }, 60_000);
});
