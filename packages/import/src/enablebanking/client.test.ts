import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnableBankingApiError, EnableBankingClient } from "./client.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

function setup(handler: (call: Call) => Response, sleeps: number[] = []) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  const client = new EnableBankingClient({ applicationId: "app-123", privateKey, fetch: fetchFn, now: () => Date.UTC(2026, 9, 2, 12), sleep: async (ms) => void sleeps.push(ms) });
  return { client, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("EnableBankingClient", () => {
  it("signiert ein JWT mit RS256 und der Application ID als kid", () => {
    const { client } = setup(() => json({}));
    const [header, payload, signature] = client.token().split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-123" });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "enablebanking.com", aud: "api.enablebanking.com" });
    expect(claims.exp - claims.iat).toBe(3600);
    const valid = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature!, "base64url"));
    expect(valid).toBe(true);
    expect(client.token()).toBe(`${header}.${payload}.${signature}`);
  });

  it("listet Banken und startet die Zustimmung", async () => {
    const { client, calls } = setup((call) =>
      call.url.pathname === "/aspsps"
        ? json({ aspsps: [{ name: "DKB", country: "DE", logo: "https://x/dkb.png", maximum_consent_validity: 15552000, psu_types: ["personal", "business"] }] })
        : json({ url: "https://bank.example/auth?x=1", authorization_id: "a1" }),
    );
    const banks = await client.aspsps("DE");
    expect(banks.map((b) => b.name)).toEqual(["DKB"]);
    expect(calls[0]!.url.search).toBe("?country=DE");
    expect(calls[0]!.headers.authorization).toMatch(/^Bearer ey/);

    const auth = await client.startAuthorization({
      aspsp: { name: "DKB", country: "DE" },
      validUntil: new Date("2027-03-31T00:00:00Z"),
      redirectUrl: "https://haben.example/api/bank/callback",
      state: "s1",
      psuType: "business",
    });
    expect(auth.url).toBe("https://bank.example/auth?x=1");
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.body).toEqual({
      access: { valid_until: "2027-03-31T00:00:00.000Z" },
      aspsp: { name: "DKB", country: "DE" },
      state: "s1",
      redirect_url: "https://haben.example/api/bank/callback",
      psu_type: "business",
    });
  });

  it("holt alle Seiten der Umsätze über den continuation_key", async () => {
    const { client, calls } = setup((call) => {
      const key = call.url.searchParams.get("continuation_key");
      const tx = (id: string) => ({ entry_reference: id, transaction_amount: { currency: "EUR", amount: "1.00" }, credit_debit_indicator: "CRDT", status: "BOOK", booking_date: "2026-10-01" });
      return key ? json({ transactions: [tx("b")], continuation_key: null }) : json({ transactions: [tx("a")], continuation_key: "k2" });
    });
    const result = await client.transactions("uid-1", "2026-09-01", "2026-10-02");
    expect(result.map((t) => t.entry_reference)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe("/accounts/uid-1/transactions");
    expect(calls[0]!.url.searchParams.get("date_from")).toBe("2026-09-01");
    expect(calls[0]!.url.searchParams.get("date_to")).toBe("2026-10-02");
    expect(calls[1]!.url.searchParams.get("continuation_key")).toBe("k2");
  });

  it("meldet Fehler mit Status und Text der API", async () => {
    const { client } = setup(() => json({ message: "Session expired", code: 401 }, 401));
    const error = await client.balances("uid-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnableBankingApiError);
    expect((error as EnableBankingApiError).status).toBe(401);
    expect((error as Error).message).toBe("Zugriff abgelehnt: Session expired");
  });

  it("wiederholt lesende Abrufe bei 429/5xx mit Retry-After oder Backoff", async () => {
    const sleeps: number[] = [];
    const answers = [
      new Response("", { status: 429, headers: { "retry-after": "7" } }),
      new Response("", { status: 503 }),
      json({ balances: [] }),
    ];
    const { client, calls } = setup(() => answers.shift()!, sleeps);
    await expect(client.balances("uid-1")).resolves.toEqual([]);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([7000, 2000]);

    const failing = setup(() => new Response("", { status: 502 }), []);
    await expect(failing.client.balances("uid-1")).rejects.toMatchObject({ status: 502 });
    expect(failing.calls).toHaveLength(4);
    const post = setup(() => new Response("", { status: 503 }), []);
    await expect(post.client.createSession("code")).rejects.toMatchObject({ status: 503 });
    expect(post.calls).toHaveLength(1);
  });

  it("nimmt eine abgelaufene Sitzung beim Löschen hin", async () => {
    const { client } = setup(() => json({ message: "not found" }, 404));
    await expect(client.deleteSession("s1")).resolves.toBeUndefined();
  });

  it("lehnt eine Antwort ohne erwartete Felder ab", async () => {
    const { client } = setup(() => json({ nope: true }));
    await expect(client.createSession("code")).rejects.toThrow(/Unerwartete Antwort/);
  });
});
