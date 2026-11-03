import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

const IBAN_A = "DE12500105170648489890";
const IBAN_B = "DE02120300000000202051";
const IBAN_C = "DE75512108001245126199";

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

/** Nachgebaute Enable-Banking-API mit zwei Konten und einer Kreditkarte ohne IBAN; mit newAccount ein drittes Konto ohne Umsätze */
function fakeApi() {
  const calls: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];
  const state = { failUntilFallback: false, expired: false, sessions: 0, onlyForeign: false, newAccount: false };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (state.expired && url.pathname.startsWith("/accounts/")) return json({ message: "Session expired" }, 401);
    if (url.pathname === "/aspsps")
      return json({ aspsps: [{ name: "Testbank", country: "DE", maximum_consent_validity: 90 * 86400, psu_types: ["business", "personal"] }] });
    if (url.pathname === "/auth") return json({ url: "https://bank.example/login", authorization_id: "a1" });
    if (url.pathname === "/sessions" && method === "POST") {
      state.sessions++;
      if (state.onlyForeign) {
        return json({
          session_id: `sess-${state.sessions}`,
          access: { valid_until: "2026-12-31T00:00:00Z" },
          accounts: [{ uid: `uid-usd-${state.sessions}`, account_id: { iban: IBAN_A }, name: "USD", currency: "USD" }],
        });
      }
      return json({
        session_id: `sess-${state.sessions}`,
        access: { valid_until: "2026-12-31T00:00:00Z" },
        accounts: [
          { uid: `uid-a-${state.sessions}`, account_id: { iban: IBAN_A }, name: "Geschäftskonto", currency: "EUR" },
          { uid: `uid-b-${state.sessions}`, account_id: { iban: IBAN_B }, name: "Tagesgeld", currency: "EUR" },
          { uid: "card", account_id: {}, name: "Kreditkarte", currency: "EUR" },
          // Unterkonto in Fremdwährung unter derselben IBAN (z. B. Finom)
          { uid: `uid-usd-${state.sessions}`, account_id: { iban: IBAN_A }, name: "USD", currency: "USD" },
          ...(state.newAccount ? [{ uid: `uid-c-${state.sessions}`, account_id: { iban: IBAN_C }, name: "Rücklagen", currency: "EUR" }] : []),
        ],
      });
    }
    if (url.pathname.startsWith("/sessions/") && method === "DELETE") return new Response(null, { status: 204 });
    const match = /^\/accounts\/([^/]+)\/(transactions|balances)$/.exec(url.pathname);
    if (match?.[2] === "balances")
      return json({ balances: [{ balance_amount: { currency: "EUR", amount: "1500.00" }, balance_type: "CLBD", reference_date: "2026-10-01" }] });
    if (match?.[2] === "transactions") {
      const from = url.searchParams.get("date_from")!;
      if (match[1]!.startsWith("uid-b") && state.failUntilFallback && from.endsWith("-01-01"))
        return json({ message: "Wrong transactions period requested" }, 422);
      const all = match[1]!.startsWith("uid-c")
        ? []
        : match[1]!.startsWith("uid-a")
          ? [
              tx("a1", "2026-09-05", "100.00", "CRDT", "Altbestand"),
              tx("a2", "2026-09-20", "49.99", "DBIT", "Telefon 9/2026"),
              tx("a3", "2026-09-28", "200.00", "CRDT", "RE-1"),
            ]
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
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;
  const api = fakeApi();
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    Object.assign(process.env, { ENABLE_BANKING_APP_ID: "app-1", ENABLE_BANKING_KEY: privateKey.replace(/\n/g, "\\n") });
    sync = await import("./bank-sync.ts");
    bank = await import("./bank.ts");
    db = await import("../../db/index.ts");
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

  async function connect(code = "code-1", fetchFrom?: string) {
    const { url } = await sync.startConnection(actor, { aspspName: "Testbank", country: "DE", psuType: "business", fetchFrom });
    expect(url).toBe("https://bank.example/login");
    const auth = api.calls.findLast((c) => c.path === "/auth")!.body as { state: string; redirect_url: string; psu_type: string };
    expect(auth.redirect_url).toBe("http://localhost:3000/api/bank/callback");
    expect(auth.psu_type).toBe("business");
    return sync.completeConnection(actor, { state: auth.state, code });
  }

  it("verbindet die Bank, legt fehlende Konten an und holt nur Umsätze nach dem letzten CSV-Import", async () => {
    api.state.failUntilFallback = true;
    // Wie das Formular: „Umsätze abrufen ab“ steht auf dem Jahresbeginn
    const result = await connect("code-1", `${today().slice(0, 4)}-01-01`);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Testbank verbunden, 3 neue Umsätze.");
    expect(result.message).toContain("1 Konten ohne IBAN");
    expect(result.message).toContain("1 Konten in Fremdwährung (USD) werden nicht abgerufen");
    expect(api.calls.some((c) => c.path.includes("uid-usd"))).toBe(false);
    // Nur das neue Konto wird genannt; das schon per CSV angelegte behält seinen Namen
    expect(result.message).toContain("Neu angelegt: Testbank Tagesgeld …2051.");

    const txCalls = api.calls.filter((c) => c.path.endsWith("/transactions"));
    expect(txCalls[0]!.query.get("date_from")).toBe("2026-09-06");
    // Konto B: ab Jahresbeginn abgelehnt, dann die letzten 89 Tage
    expect(txCalls[1]!.query.get("date_from")).toMatch(/-01-01$/);
    expect(txCalls[2]!.query.get("date_from")).not.toMatch(/-01-01$/);

    const accounts = await db.db.select().from(db.schema.bankAccounts);
    expect(accounts.map((a) => [a.iban, a.name]).sort()).toEqual(
      [
        [IBAN_B, "Testbank Tagesgeld …2051"],
        [IBAN_A, "DKB Business"],
      ].sort(),
    );
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

  it("followUpStart: überlappt sieben Tage, aber nicht in die Tage einer Datei", () => {
    expect(sync.followUpStart("2026-11-01", null, "2026-11-02")).toBe("2026-10-25");
    // Finom: camt-Datei bis 31.10., erster Abruf am 01.11.
    expect(sync.followUpStart("2026-11-01", "2026-10-31", "2026-11-02")).toBe("2026-11-01");
    expect(sync.followUpStart("2026-11-01", "2026-09-30", "2026-11-02")).toBe("2026-10-25");
    expect(sync.followUpStart("2026-11-01", "2026-11-05", "2026-11-02")).toBe("2026-11-02");
    // Umzug unter dem Jahr: erster Abruf ab 01.11., der zweite am 02.11. geht nicht bis 26.10. zurück
    expect(sync.followUpStart("2026-11-02", null, "2026-11-03", "2026-11-01")).toBe("2026-11-01");
    expect(sync.followUpStart("2026-11-20", null, "2026-11-21", "2026-11-01")).toBe("2026-11-13");
  });

  it("überlappt nicht in Tage, die schon eine Datei abdeckt", async () => {
    // Für Konto B nachträglich eine Datei bis zum 03.10. importiert, mitten in die sieben Tage vor dem letzten Abruf (09.10.)
    await db.db.transaction((t) =>
      bank.storeStatement(
        t,
        {
          format: "camt053",
          accountIban: IBAN_B,
          currency: "EUR",
          transactions: [{ bookingDate: "2026-10-03", amount: -350, currency: "EUR", counterpartyName: "IONOS", purpose: "", index: 0 }],
          warnings: [],
        },
        { filename: "auszug.xml", sha256: "y" },
        null,
      ),
    );
    const [connection] = await sync.listConnections();
    api.calls.length = 0;
    await sync.syncConnection(actor, connection!.id, "2026-10-12");
    const from = (uid: string) => api.calls.find((c) => c.path === `/accounts/${uid}/transactions`)!.query.get("date_from");
    expect(from(connection!.accounts[0]!.uid)).toBe("2026-10-02");
    expect(from(connection!.accounts[1]!.uid)).toBe("2026-10-04");
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

  it("firstSyncStart: gewählter Tag statt Jahresbeginn, aber nie in Tage mit vorhandenen Umsätzen", () => {
    // Heute 02.11.2026, die letzten 89 Tage beginnen am 05.08.
    expect(sync.firstSyncStart(null, undefined, "2026-11-02")).toEqual({ from: "2026-01-01", fallback: "2026-08-05" });
    // Vorgabe im Formular: Jahresbeginn; lehnt die Bank ab, die letzten 89 Tage wie ohne gewählten Tag
    expect(sync.firstSyncStart(null, "2026-01-01", "2026-11-02")).toEqual({ from: "2026-01-01", fallback: "2026-08-05" });
    // Umzug unter dem Jahr: Buchhaltung in Haben ab 01.11.
    expect(sync.firstSyncStart(null, "2026-11-01", "2026-11-02")).toEqual({ from: "2026-11-01", fallback: null });
    expect(sync.firstSyncStart(null, "2026-07-01", "2026-11-02")).toEqual({ from: "2026-07-01", fallback: "2026-08-05" });
    expect(sync.firstSyncStart(null, "2026-08-05", "2026-11-02")).toEqual({ from: "2026-08-05", fallback: null });
    // Vorhandene Umsätze: weiter am Tag danach, ohne Rückfall
    expect(sync.firstSyncStart("2026-10-31", "2026-10-01", "2026-11-02")).toEqual({ from: "2026-11-01", fallback: null });
    expect(sync.firstSyncStart("2026-10-31", undefined, "2026-11-02")).toEqual({ from: "2026-11-01", fallback: null });
    // Umsätze vor dem gewählten Tag: der gewählte Tag gilt
    expect(sync.firstSyncStart("2026-09-30", "2026-11-01", "2026-11-02")).toEqual({ from: "2026-11-01", fallback: null });
    expect(sync.firstSyncStart("2025-06-30", "2026-01-01", "2026-11-02")).toEqual({ from: "2026-01-01", fallback: "2026-08-05" });
    // Verbindung ohne gewählten Tag (vor Migration 0087): nahtlos an die Datei, auch aus dem Vorjahr
    expect(sync.firstSyncStart("2025-06-30", undefined, "2026-11-02")).toEqual({ from: "2025-07-01", fallback: null });
  });

  it("firstSyncStart: kein Rückfall, wenn die Datei lückenlos bis vor den gewählten Tag reicht", () => {
    // Umzug zum Jahreswechsel: Kontoauszug als Datei bis 31.12., Formular-Vorgabe 01.01. Lehnt die Bank den Zeitraum ab,
    // ließe der Rückfall auf die letzten 89 Tage still eine Lücke vom 01.01. bis 04.08.; auf main kam dann eine Fehlermeldung.
    expect(sync.firstSyncStart("2025-12-31", "2026-01-01", "2026-11-02")).toEqual({ from: "2026-01-01", fallback: null });
    expect(sync.firstSyncStart("2026-06-30", "2026-07-01", "2026-11-02")).toEqual({ from: "2026-07-01", fallback: null });
  });

  it("merkt sich den gewählten Abrufbeginn, gibt ihn aber nicht an schon abgerufene Konten weiter", async () => {
    await expect(sync.startConnection(actor, { aspspName: "Testbank", country: "DE", psuType: "business", fetchFrom: "2999-01-01" })).rejects.toThrow(
      /Zukunft/,
    );
    const result = await connect("code-3", "2026-10-01");
    expect(result.ok).toBe(true);
    const [connection] = await sql`select fetch_from::text as fetch_from, accounts from bank_connections where status = 'aktiv'`;
    expect(connection!.fetch_from).toBe("2026-10-01");
    // Beide Konten haben einen Abrufstand: der Abruf macht dort weiter, der gewählte Tag gilt nur für neue Konten;
    // die Konten behalten den Tag vom ersten Verbinden
    const yearStart = `${today().slice(0, 4)}-01-01`;
    expect(connection!.accounts.map((a: { fetchFrom?: string }) => a.fetchFrom)).toEqual([yearStart, yearStart]);
  });

  it("ruft ein neues Konto ab dem gewählten Tag ab, die anderen beim Abrufstand", async () => {
    api.state.newAccount = true;
    api.calls.length = 0;
    const result = await connect("code-4", "2026-10-15");
    api.state.newAccount = false;
    expect(result.ok).toBe(true);
    const from = (prefix: string) =>
      api.calls.find((c) => c.path.startsWith(`/accounts/${prefix}`) && c.path.endsWith("/transactions"))!.query.get("date_from");
    expect(from("uid-c")).toBe("2026-10-15");
    expect(from("uid-a")).not.toBe("2026-10-15");
    const [connection] = await sync.listConnections();
    const yearStart = `${today().slice(0, 4)}-01-01`;
    expect(connection!.accounts.map((a) => [a.iban, a.fetchFrom])).toEqual([
      [IBAN_A, yearStart],
      [IBAN_B, yearStart],
      [IBAN_C, "2026-10-15"],
    ]);
  });

  it("geht auch bei Folgeabrufen nicht vor den gewählten Tag zurück", async () => {
    // Erster Abruf des neuen Kontos C ab 15.10. am 16.10.; der Folgeabruf am 17.10. überlappt sonst bis 09.10.
    const [connection] = await sync.listConnections();
    const accounts = connection!.accounts.map((a) => (a.iban === IBAN_C ? { ...a, syncedTo: "2026-10-16" } : a));
    await sql`update bank_connections set accounts = ${JSON.stringify(accounts)}::jsonb where id = ${connection!.id}`;
    api.calls.length = 0;
    await sync.syncConnection(actor, connection!.id, "2026-10-17");
    const fromC = api.calls.find((c) => c.path.startsWith("/accounts/uid-c") && c.path.endsWith("/transactions"))!.query.get("date_from");
    expect(fromC).toBe("2026-10-15");
    const [after] = await sync.listConnections();
    expect(after!.accounts.find((a) => a.iban === IBAN_C)).toMatchObject({ fetchFrom: "2026-10-15", syncedTo: "2026-10-17" });
  });

  it("behält den gewählten Tag beim Erneuern der Zustimmung", async () => {
    // Konto C zuletzt am 17.10. abgerufen, gewählter Tag 15.10. Wird die Zustimmung kurz darauf erneuert, ginge der
    // Folgeabruf sonst sieben Tage vor den letzten Abruf zurück, also wieder vor den 15.10.
    const [connection] = await sync.listConnections();
    const accounts = connection!.accounts.map((a) => (a.iban === IBAN_C ? { ...a, syncedTo: "2026-10-17" } : a));
    await sql`update bank_connections set accounts = ${JSON.stringify(accounts)}::jsonb where id = ${connection!.id}`;
    api.state.newAccount = true;
    api.calls.length = 0;
    const result = await connect("code-5");
    api.state.newAccount = false;
    expect(result.ok).toBe(true);
    const [after] = await sync.listConnections();
    expect(after!.accounts.find((a) => a.iban === IBAN_C)).toMatchObject({ fetchFrom: "2026-10-15" });
    const fromC = api.calls.find((c) => c.path.startsWith("/accounts/uid-c") && c.path.endsWith("/transactions"))!.query.get("date_from");
    expect(fromC! >= "2026-10-15").toBe(true);
  });

  it("trennt eine Verbindung, die Umsätze bleiben", async () => {
    for (const c of await sync.listConnections()) await sync.removeConnection(actor, c.id);
    expect(await sync.listConnections()).toEqual([]);
    const [count] = await sql`select count(*)::int as n from bank_transactions`;
    // vier abgerufene bzw. per CSV importierte, dazu der Umsatz aus der Datei für Konto B
    expect(count!.n).toBe(5);
    const audit = await sql`select action, new_value from audit_log where table_name = 'bank_connections' and action = 'INSERT' limit 1`;
    expect(audit[0]!.new_value).not.toHaveProperty("ciphertext");
  });

  it("gibt die Bank nur Fremdwährungskonten frei, sagt die Meldung das statt „kein Konto mit IBAN“", async () => {
    api.state.onlyForeign = true;
    const result = await connect("code-usd");
    api.state.onlyForeign = false;
    expect(result.ok).toBe(false);
    expect(result.message).toContain("1 Konten in Fremdwährung (USD) werden nicht abgerufen");
    expect(result.message).not.toContain("kein Konto mit IBAN");
    const [connection] = await sync.listConnections();
    expect(connection!.status).toBe("fehler");
    expect(connection!.lastError).not.toContain("kein Konto mit IBAN");
    for (const c of await sync.listConnections()) await sync.removeConnection(actor, c.id);
  });

  it("nimmt den Zugang aus den Einstellungen vor der Umgebung und prüft ihn beim Speichern", async () => {
    const used: string[] = [];
    const { EnableBankingClient } = await import("@haben/import");
    sync.setEnableBankingClientFactory((o) => {
      used.push(o.applicationId);
      return new EnableBankingClient({ ...o, fetch: api.fetchFn });
    });
    expect(await sync.enableBankingSettingsSummary()).toMatchObject({ source: "umgebung", applicationId: "app-1" });

    await expect(sync.saveEnableBankingSettings(actor, { applicationId: "app-2", privateKey: "kein Schlüssel" })).rejects.toThrow(/keine gültige \.pem-Datei/);
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    await expect(sync.saveEnableBankingSettings(actor, { applicationId: "app-2" })).rejects.toThrow(/Schlüssel \(\.pem\) fehlt/);
    await sync.saveEnableBankingSettings(actor, { applicationId: "app-2", privateKey });
    expect(used).toEqual(["app-2"]);
    expect(await sync.enableBankingSettingsSummary()).toMatchObject({ source: "einstellungen", applicationId: "app-2" });

    // Ohne neuen Schlüssel bleibt der gespeicherte; die neue ID wird wieder geprüft
    await sync.saveEnableBankingSettings(actor, { applicationId: "app-3" });
    used.length = 0;
    await sync.listBanks("DE");
    expect(used).toEqual(["app-3"]);

    const [row] = await sql`select ciphertext from enable_banking_settings`;
    expect(Buffer.from(row!.ciphertext).toString("utf8")).not.toContain("PRIVATE KEY");
    const audit = await sql`select new_value from audit_log where table_name = 'enable_banking_settings'`;
    expect(audit.length).toBeGreaterThan(0);
    for (const a of audit) expect(a.new_value).not.toHaveProperty("ciphertext");

    await sync.deleteEnableBankingSettings(actor);
    expect(await sync.enableBankingSettingsSummary()).toMatchObject({ source: "umgebung", applicationId: "app-1" });
  });

  it("speichert keinen Zugang, den Enable Banking ablehnt", async () => {
    const { EnableBankingClient } = await import("@haben/import");
    const reject = (async () =>
      new Response(JSON.stringify({ message: "Invalid JWT" }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
    sync.setEnableBankingClientFactory((o) => new EnableBankingClient({ ...o, fetch: reject }));
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    await expect(sync.saveEnableBankingSettings(actor, { applicationId: "falsch", privateKey })).rejects.toThrow(/lehnt den Zugang ab/);
    const [count] = await sql`select count(*)::int as n from enable_banking_settings`;
    expect(count!.n).toBe(0);
    sync.setEnableBankingClientFactory((o) => new EnableBankingClient({ ...o, fetch: api.fetchFn }));
  });
});
