import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkAppStoreCredentials, createAppStoreClient } from "./appstore.ts";
import { createGooglePlayClient, earningsMonth, googlePlayBucket, parseServiceAccount } from "./googleplay.ts";
import { addReportMonths, reportMonthsBetween, StoreApiError } from "./http.ts";

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const p8 = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaPem = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const NOW = Date.parse("2026-11-10T12:00:00Z");
const noSleep = async () => {};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** Fake-fetch: beantwortet Aufrufe der Reihe nach und merkt sie sich */
function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`unerwarteter Aufruf ${String(url)}`);
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function decodeJwt(token: string) {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>,
    input: `${header}.${payload}`,
    signature: Buffer.from(signature, "base64url"),
  };
}

const credentials = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", vendorNumber: "85012345", privateKey: p8 };

describe("App Store Connect", () => {
  it("signiert ES256 als r‖s (64 Byte) mit kid, iss und aud, höchstens 20 Minuten", async () => {
    const { fetch, calls } = fakeFetch([() => new Response(new Uint8Array([0x1f, 0x8b, 1, 2]), { status: 200 })]);
    const client = createAppStoreClient({ credentials, fetch, now: () => NOW, sleep: noSleep });
    const report = await client.financeDetail("2026-10");
    expect(report).toEqual(new Uint8Array([0x1f, 0x8b, 1, 2]));

    const auth = new Headers(calls[0]!.init?.headers).get("authorization")!;
    const jwt = decodeJwt(auth.replace(/^Bearer /, ""));
    expect(jwt.header).toEqual({ kid: "2X9R4HXF34", alg: "ES256", typ: "JWT" });
    expect(jwt.payload).toMatchObject({ iss: credentials.issuerId, aud: "appstoreconnect-v1", iat: NOW / 1000 });
    expect((jwt.payload.exp as number) - (jwt.payload.iat as number)).toBeLessThanOrEqual(20 * 60);
    expect(jwt.signature).toHaveLength(64);
    const valid = createVerify("SHA256").update(jwt.input).verify({ key: ec.publicKey, dsaEncoding: "ieee-p1363" }, jwt.signature);
    expect(valid).toBe(true);

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/financeReports");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "filter[vendorNumber]": "85012345",
      "filter[regionCode]": "Z1",
      "filter[reportType]": "FINANCE_DETAIL",
      "filter[reportDate]": "2026-10",
    });
  });

  it("liefert null, wenn es für den Monat keinen Bericht gibt", async () => {
    const { fetch } = fakeFetch([json({ errors: [{ code: "NOT_FOUND", title: "The specified resource does not exist" }] }, 404)]);
    const client = createAppStoreClient({ credentials, fetch, now: () => NOW, sleep: noSleep });
    expect(await client.financeDetail("2026-10")).toBeNull();
  });

  it("wiederholt nach 429 mit Retry-After und meldet 403 mit Hinweis auf die Rolle", async () => {
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      json({ errors: [{ title: "Forbidden", detail: "The API key in use does not allow this request" }] }, 403),
    ]);
    const client = createAppStoreClient({ credentials, fetch, now: () => NOW, sleep: async (ms) => void waits.push(ms) });
    const error = await client.financeDetail("2026-10").catch((e: unknown) => e);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    expect(error).toBeInstanceOf(StoreApiError);
    expect((error as StoreApiError).status).toBe(403);
    expect((error as Error).message).toContain("Rolle Finance");
  });

  it("prüft Issuer ID, Key ID, Vendor-Nummer und Schlüsseltyp", () => {
    expect(checkAppStoreCredentials({ ...credentials, keyId: " 2X9R4HXF34 " }).keyId).toBe("2X9R4HXF34");
    expect(() => checkAppStoreCredentials({ ...credentials, issuerId: "abc" })).toThrow(/Issuer ID/);
    expect(() => checkAppStoreCredentials({ ...credentials, keyId: "kurz" })).toThrow(/Key ID/);
    expect(() => checkAppStoreCredentials({ ...credentials, vendorNumber: "x" })).toThrow(/Vendor/);
    expect(() => checkAppStoreCredentials({ ...credentials, privateKey: rsaPem })).toThrow(/\.p8/);
  });
});

const serviceAccount = { clientEmail: "haben@projekt.iam.gserviceaccount.com", privateKey: rsaPem };

describe("Google Play", () => {
  it("holt ein Token per JWT-Bearer und listet die Einnahmenberichte über alle Seiten", async () => {
    const { fetch, calls } = fakeFetch([
      json({ access_token: "ya29.token", expires_in: 3599 }),
      json({
        items: [
          { name: "earnings/earnings_202610_1234567890-1.zip", size: "2048" },
          { name: "earnings/README.txt", size: "1" },
        ],
        nextPageToken: "seite2",
      }),
      json({ items: [{ name: "earnings/earnings_202609_1234567890-1.zip", size: "1024" }] }),
    ]);
    const client = createGooglePlayClient({ serviceAccount, bucket: "gs://pubsite_prod_rev_0123456789/earnings", fetch, now: () => NOW, sleep: noSleep });
    expect(await client.listEarnings()).toEqual([
      { name: "earnings/earnings_202609_1234567890-1.zip", month: "2026-09", size: 1024 },
      { name: "earnings/earnings_202610_1234567890-1.zip", month: "2026-10", size: 2048 },
    ]);

    const tokenCall = new URLSearchParams(String(calls[0]!.init?.body));
    expect(tokenCall.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const jwt = decodeJwt(tokenCall.get("assertion")!);
    expect(jwt.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(jwt.payload).toMatchObject({
      iss: serviceAccount.clientEmail,
      scope: "https://www.googleapis.com/auth/devstorage.read_only",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(createVerify("RSA-SHA256").update(jwt.input).verify(rsa.publicKey, jwt.signature)).toBe(true);

    expect(calls[1]!.url).toContain("/storage/v1/b/pubsite_prod_rev_0123456789/o?prefix=earnings%2F");
    expect(new Headers(calls[1]!.init?.headers).get("authorization")).toBe("Bearer ya29.token");
    expect(calls[2]!.url).toContain("pageToken=seite2");
  });

  it("lädt einen Bericht unverändert und verwendet das Token weiter", async () => {
    const { fetch, calls } = fakeFetch([
      json({ access_token: "ya29.token", expires_in: 3599 }),
      () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200 }),
      () => new Response(new Uint8Array([0x50, 0x4b, 3, 4, 5]), { status: 200 }),
    ]);
    const client = createGooglePlayClient({ serviceAccount, bucket: "pubsite_prod_rev_0123456789", fetch, now: () => NOW, sleep: noSleep });
    expect(await client.download("earnings/earnings_202610_1-1.zip")).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    await client.download("earnings/earnings_202611_1-1.zip");
    expect(calls).toHaveLength(3);
    expect(calls[1]!.url).toContain("/o/earnings%2Fearnings_202610_1-1.zip?alt=media");
  });

  it("meldet fehlende Finanzrechte mit Hinweis", async () => {
    const { fetch } = fakeFetch([json({ access_token: "t" }), json({ error: { code: 403, message: "does not have storage.objects.list access" } }, 403)]);
    const client = createGooglePlayClient({ serviceAccount, bucket: "pubsite_prod_rev_1", fetch, now: () => NOW, sleep: noSleep });
    await expect(client.listEarnings()).rejects.toThrow(/Finanzdaten ansehen/);
  });

  it("nimmt nur den Bucket der Play Console und nur Einnahmenberichte", () => {
    expect(googlePlayBucket(" gs://pubsite_prod_rev_0123/ ")).toBe("pubsite_prod_rev_0123");
    expect(() => googlePlayBucket("gs://mein-bucket")).toThrow(/Play Console/);
    expect(earningsMonth("earnings/earnings_202612_x.zip")).toBe("2026-12");
    expect(earningsMonth("sales/salesreport_202612.zip")).toBeNull();
    expect(earningsMonth("earnings/earnings_202613_x.zip")).toBeNull();
  });

  it("liest die Schlüsseldatei des Servicekontos", () => {
    const file = JSON.stringify({ type: "service_account", client_email: serviceAccount.clientEmail, private_key: rsaPem });
    expect(parseServiceAccount(file)).toEqual(serviceAccount);
    expect(() => parseServiceAccount("{")).toThrow(/kein JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: "authorized_user" }))).toThrow(/Servicekonto/);
  });
});

describe("Berichtsmonate", () => {
  it("zählt über den Jahreswechsel", () => {
    expect(addReportMonths("2026-11", 2)).toBe("2027-01");
    expect(addReportMonths("2026-01", -1)).toBe("2025-12");
    expect(reportMonthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(reportMonthsBetween("2027-01", "2026-12")).toEqual([]);
  });
});
