import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationUrl, createEtsyClient, createPkce, EtsyApiError, tokenFromResponse, type EtsyTokens } from "./etsy-api.ts";

/*
 * Schnittstelle zur Etsy-API: Anmeldung, Seitenweise Abruf des Verlaufs, Erneuerung des Zugangstokens und der
 * Bestellbezug. Netzwerk, Uhr und Warten sind injiziert, damit kein echter Abruf nötig ist.
 */

const ABGELAUFEN: EtsyTokens = { accessToken: "alt", refreshToken: "erneuern", expiresAt: 1_000 };
const GUELTIG: EtsyTokens = { accessToken: "gut", refreshToken: "erneuern", expiresAt: 4_000_000_000 };

interface Ruf {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Antwortet nach Pfad und liefert die Rufe zurück */
function mockFetch(antworten: (ruf: Ruf) => unknown, status = 200) {
  const rufe: Ruf[] = [];
  const fetch: typeof globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const ruf: Ruf = { url, headers, body: init?.body === undefined ? undefined : String(init.body) };
    rufe.push(ruf);
    const body = antworten(ruf);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch, rufe };
}

const lauf = { now: () => 2_000_000_000_000, sleep: async () => {} };

describe("Etsy-Client", () => {
  it("holt den Verlauf seitenweise und in Fenstern von höchstens 31 Tagen", async () => {
    const fenster: string[] = [];
    const { fetch, rufe } = mockFetch((ruf) => {
      const url = new URL(ruf.url);
      if (url.pathname.endsWith("/ledger-entries")) {
        fenster.push(`${url.searchParams.get("min_created")}-${url.searchParams.get("max_created")}`);
        const offset = Number(url.searchParams.get("offset"));
        return offset === 0
          ? { count: 150, results: [{ entry_id: 1, amount: 100, currency: "EUR", ledger_type: "PAYMENT_GROSS", created_timestamp: 2 }] }
          : { count: 150, results: [{ entry_id: 2, amount: 200, currency: "EUR", ledger_type: "prolist", created_timestamp: 1 }] };
      }
      return { count: 0, results: [] };
    });
    const client = createEtsyClient({
      keystring: "abc",
      sharedSecret: "geheim",
      shopId: "12345",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    const from = 1_700_000_000;
    const to = from + 40 * 24 * 60 * 60;
    const entries = await client.ledger(from, to);

    // Zwei Fenster (31 Tage, dann der Rest), im ersten zwei Seiten; die Antwort des Nachbaus wiederholt sich
    const grenze = from + 31 * 24 * 60 * 60;
    expect(fenster).toHaveLength(4);
    expect(fenster[0]).toBe(`${from}-${grenze}`);
    expect(fenster[2]).toBe(`${grenze}-${to}`);
    expect(entries.map((e) => e.created_timestamp)).toEqual([1, 1, 2, 2]);
    expect(rufe[0]!.headers["x-api-key"]).toBe("abc:geheim");
    expect(rufe[0]!.headers.authorization).toBe("Bearer gut");
  });

  it("erneuert ein abgelaufenes Zugangstoken und meldet es zurück", async () => {
    const gemeldet: EtsyTokens[] = [];
    const { fetch, rufe } = mockFetch((ruf) => {
      if (ruf.url.includes("/oauth/token")) return { access_token: "neu", refresh_token: "erneuern2", expires_in: 3600 };
      return { count: 0, results: [] };
    });
    const client = createEtsyClient({
      keystring: "abc",
      sharedSecret: "geheim",
      shopId: "12345",
      tokens: ABGELAUFEN,
      tokenUrl: "https://etsy.test/oauth/token",
      baseUrl: "https://etsy.test/v3/application",
      onTokens: (t) => {
        gemeldet.push(t);
      },
      runtime: { ...lauf, fetch },
    });
    await client.ledger(1, 2);

    const tokenRuf = rufe.find((r) => r.url.includes("/oauth/token"))!;
    expect(tokenRuf.body).toContain("grant_type=refresh_token");
    expect(tokenRuf.body).toContain("refresh_token=erneuern");
    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0]!.accessToken).toBe("neu");
    expect(gemeldet[0]!.expiresAt).toBe(2_000_000_000 + 3600);
    expect(rufe.find((r) => r.url.includes("ledger-entries"))!.headers.authorization).toBe("Bearer neu");
  });

  it("ordnet Zahlungs- und Erstattungsnummern ihren Bestellungen zu, in Bündeln von 20", async () => {
    const { fetch, rufe } = mockFetch(() => ({
      results: [{ receipt_id: 999, payment_id: 11, payment_adjustments: [{ payment_adjustment_id: 22 }] }],
    }));
    const client = createEtsyClient({
      keystring: "abc",
      shopId: "12345",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    const kennungen = Array.from({ length: 25 }, (_, i) => String(i + 1));
    const zuordnung = await client.ordersFor(kennungen);

    expect(rufe).toHaveLength(2);
    expect(rufe[0]!.url).toContain("ledger_entry_ids=1%2C2");
    expect(zuordnung.get("11")).toBe("999");
    expect(zuordnung.get("22")).toBe("999");
  });

  it("übersetzt 401 und 403 in eine lesbare Meldung", async () => {
    const { fetch } = mockFetch(() => ({ error: "invalid_token" }), 401);
    const client = createEtsyClient({
      keystring: "abc",
      shopId: "12345",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    await expect(client.ledger(1, 2)).rejects.toThrow(EtsyApiError);
    await expect(client.ledger(1, 2)).rejects.toThrow(/neu hergestellt/);
  });

  it("findet den Shop auch, wenn Etsy ihn einzeln statt als Liste liefert", async () => {
    const antworten: Record<string, unknown> = {
      "/users/me": { user_id: 126878829, shop_id: 35160089 },
      "/users/126878829/shops": { shop_id: 35160089, shop_name: "NiruHobbyArt" },
    };
    const { fetch } = mockFetch((ruf) => antworten[new URL(ruf.url).pathname.replace("/v3/application", "")] ?? {});
    const client = createEtsyClient({
      keystring: "abc",
      shopId: "",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    expect(await client.shop()).toEqual({ shopId: "35160089", shopName: "NiruHobbyArt" });
  });

  it("nimmt die Kennung aus /users/me, wenn die Shop-Abfrage leer bleibt", async () => {
    const antworten: Record<string, unknown> = {
      "/users/me": { user_id: 126878829, shop_id: 35160089 },
      "/users/126878829/shops": { count: 0, results: [] },
    };
    const { fetch } = mockFetch((ruf) => antworten[new URL(ruf.url).pathname.replace("/v3/application", "")] ?? {});
    const client = createEtsyClient({
      keystring: "abc",
      shopId: "",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    expect(await client.shop()).toEqual({ shopId: "35160089", shopName: "" });
  });

  it("baut die Anmeldeadresse und die PKCE-Challenge", () => {
    const { verifier, challenge } = createPkce((size) => new Uint8Array(size).fill(7));
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);

    const url = new URL(
      authorizationUrl({
        keystring: "abc:geheim",
        redirectUri: "https://haben.test/etsy/callback",
        scopes: "transactions_r shops_r",
        state: "zufall",
        codeChallenge: challenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://haben.test/etsy/callback");
  });

  it("nimmt ein neues Erneuerungstoken an und behält sonst das alte", () => {
    const mitNeuem = tokenFromResponse({ access_token: "a", refresh_token: "b", expires_in: 3600 }, "alt", 1_000);
    expect(mitNeuem).toEqual({ accessToken: "a", refreshToken: "b", expiresAt: 3601 });
    const ohne = tokenFromResponse({ access_token: "a" }, "alt", 1_000);
    expect(ohne.refreshToken).toBe("alt");
    expect(() => tokenFromResponse({ error: "invalid_grant" }, "alt", 1_000)).toThrow(/invalid_grant/);
  });

  it("liest das Land aus der Liste der Bestellungen des Zeitraums und fragt nur Fehlende einzeln nach", async () => {
    const { fetch, rufe } = mockFetch((ruf) => {
      const url = new URL(ruf.url);
      if (url.pathname.endsWith("/shops/35160089/receipts")) {
        return {
          count: 2,
          results: [
            { receipt_id: 2001, country_iso: "DE" },
            { receipt_id: 2002, country_iso: "us" },
          ],
        };
      }
      if (url.pathname.endsWith("/receipts/1999")) return { receipt_id: 1999, country_iso: "FR" };
      return {};
    });
    const client = createEtsyClient({
      keystring: "abc",
      shopId: "35160089",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    // 1999 ist eine ältere Bestellung (etwa erstattet) und steht nicht in der Liste des Zeitraums
    const laender = await client.countriesFor(["2001", "2002", "1999"], { from: 1_700_000_000, to: 1_700_100_000 });
    expect(laender).toEqual(
      new Map([
        ["2001", "DE"],
        ["2002", "US"],
        ["1999", "FR"],
      ]),
    );
    expect(rufe.map((r) => new URL(r.url).pathname)).toEqual(["/v3/application/shops/35160089/receipts", "/v3/application/shops/35160089/receipts/1999"]);
  });

  it("liest das Land je Bestellung aus dem Receipt und lässt Bestellungen ohne Land weg", async () => {
    const antworten: Record<string, unknown> = {
      "/shops/35160089/receipts/1001": { receipt_id: 1001, country_iso: "de" },
      "/shops/35160089/receipts/1002": { receipt_id: 1002, country_iso: "US" },
      "/shops/35160089/receipts/1003": { receipt_id: 1003, country_iso: null },
    };
    const { fetch, rufe } = mockFetch((ruf) => antworten[new URL(ruf.url).pathname.replace("/v3/application", "")] ?? {});
    const client = createEtsyClient({
      keystring: "abc",
      shopId: "35160089",
      tokens: GUELTIG,
      baseUrl: "https://etsy.test/v3/application",
      runtime: { ...lauf, fetch },
    });
    const laender = await client.countriesFor(["1001", "1002", "1003", "1001"]);
    expect(laender).toEqual(
      new Map([
        ["1001", "DE"],
        ["1002", "US"],
      ]),
    );
    expect(rufe.map((r) => new URL(r.url).pathname)).toEqual([
      "/v3/application/shops/35160089/receipts/1001",
      "/v3/application/shops/35160089/receipts/1002",
      "/v3/application/shops/35160089/receipts/1003",
    ]);
  });
});
