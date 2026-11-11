import { afterEach, describe, expect, it } from "vitest";
import { MailError } from "../errors.ts";
import { type GraphCredentials, setMsalOverridesForTests, tokenProviderFor } from "./token.ts";
import { makeTestCertificate } from "./zertifikat-testhilfe.ts";

/**
 * Der Anmeldeweg mit @azure/msal-node, mit eigenem Netzwerkzugriff statt Microsoft: Er läuft hier unter derselben Laufzeit
 * (Bun) wie in Haben und zeigt, was msal an den Tokenendpunkt schickt.
 */
const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "99999999-8888-7777-6666-555555555555";
const certificate = makeTestCertificate();

const metadata = JSON.stringify({
  token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
  authorization_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
  issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
});

type Post = { url: string; body: URLSearchParams };

function fakeNetwork(respond: () => { status: number; body: unknown }) {
  const posts: Post[] = [];
  const client = {
    sendGetRequestAsync: async () => {
      throw new Error("unerwarteter GET");
    },
    sendPostRequestAsync: async (url: string, options?: { body?: string }) => {
      posts.push({ url, body: new URLSearchParams(options?.body ?? "") });
      return { headers: {}, ...respond() };
    },
  };
  setMsalOverridesForTests({ networkClient: client as never, authorityMetadata: metadata });
  return posts;
}

const token = (accessToken: string) => ({ status: 200, body: { access_token: accessToken, token_type: "Bearer", expires_in: 3600 } });
const secretCredentials: GraphCredentials = { tenantId: TENANT, clientId: CLIENT, secret: "client-secret", auth: "secret", thumbprint: null };

describe("Token für Microsoft Graph (msal-node)", () => {
  afterEach(() => setMsalOverridesForTests(undefined));

  it("holt mit dem Client Secret ein Token für den Scope von Graph und hält es im Speicher", async () => {
    const posts = fakeNetwork(() => token("zugriffstoken-1"));
    const provider = tokenProviderFor(secretCredentials);
    expect(await provider()).toBe("zugriffstoken-1");
    expect(await provider()).toBe("zugriffstoken-1");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.split("?")[0]).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    expect(posts[0]!.body.get("grant_type")).toBe("client_credentials");
    expect(posts[0]!.body.get("scope")).toBe("https://graph.microsoft.com/.default");
    expect(posts[0]!.body.get("client_id")).toBe(CLIENT);
    expect(posts[0]!.body.get("client_secret")).toBe("client-secret");
  });

  it("nimmt für geänderte Zugangsdaten eine neue Anmeldung statt des alten Tokens", async () => {
    let n = 0;
    fakeNetwork(() => token(`token-${++n}`));
    expect(await tokenProviderFor(secretCredentials)()).toBe("token-1");
    expect(await tokenProviderFor({ ...secretCredentials, secret: "neues-secret" })()).toBe("token-2");
  });

  it.skipIf(!certificate)("meldet sich mit dem Zertifikat über eine signierte Assertion an, ohne Secret", async () => {
    const { certificatePem, privateKeyPem } = certificate!;
    const { readCertificate } = await import("./certificate.ts");
    const { thumbprint } = readCertificate(certificatePem, privateKeyPem);
    const posts = fakeNetwork(() => token("zertifikat-token"));
    const provider = tokenProviderFor({ tenantId: TENANT, clientId: CLIENT, secret: privateKeyPem, auth: "certificate", thumbprint });
    expect(await provider()).toBe("zertifikat-token");
    const body = posts[0]!.body;
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const [header, payload] = body
      .get("client_assertion")!
      .split(".")
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
    expect(header.alg).toBe("PS256");
    expect(Buffer.from(header["x5t#S256"], "base64url").toString("hex")).toBe(thumbprint);
    expect(payload.iss).toBe(CLIENT);
    expect(payload.aud).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
  });

  it("meldet einen abgelehnten Anmeldeversuch auf Deutsch, ohne das Secret zu nennen", async () => {
    fakeNetwork(() => ({
      status: 401,
      body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided.\r\nTrace ID: abc", error_codes: [7000215] },
    }));
    const error = await tokenProviderFor(secretCredentials)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect((error as Error).message).toContain("Die Anmeldung bei Microsoft Entra ID ist fehlgeschlagen");
    expect((error as Error).message).toContain("AADSTS7000215");
    expect((error as Error).message).not.toContain("client-secret");
    expect((error as Error).message).not.toContain("\n");
  });
});
