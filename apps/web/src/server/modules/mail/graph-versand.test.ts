import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { setMsalOverridesForTests } from "./graph/token.ts";

const TENANT = "11111111-2222-3333-4444-555555555555";
const SECRET = "geheimes-client-secret-0815";
const ACCESS_TOKEN = "zugriffstoken-geheim-4711";

/** Der ganze Weg über Microsoft Graph, mit gemocktem Entra-ID-Endpunkt und gemocktem fetch: kein echter Tenant, kein Netz */
describe.skipIf(!testDatabaseUrl)("Versand über Microsoft Graph aus den gespeicherten Einstellungen (Postgres)", () => {
  let mail: typeof import("./mail.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  const settings = {
    transport: "graph" as const,
    graphTenantId: TENANT,
    graphClientId: "99999999-8888-7777-6666-555555555555",
    graphAuth: "secret" as const,
    graphMailbox: "shared@testfirma.example",
    clientSecret: SECRET,
    fromAddress: "rechnung@testfirma.example",
    reminderTo: "max@testfirma.example",
    remindersEnabled: false,
    reminderDays: [],
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    mail = await import("./mail.ts");
    setMsalOverridesForTests({
      authorityMetadata: JSON.stringify({
        token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
        authorization_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
        issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      }),
      networkClient: {
        sendGetRequestAsync: async () => {
          throw new Error("unerwarteter GET");
        },
        sendPostRequestAsync: async () => ({ headers: {}, status: 200, body: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600 } }),
      } as never,
    });
  }, 30_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    setMsalOverridesForTests(undefined);
    await sql?.end();
  });

  it("sendet die Test-Mail aus dem eingestellten Postfach und protokolliert den Versandweg", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await mail.saveMailSettings(actor, settings);
    expect(await mail.sendTestMail(actor)).toEqual({ ok: true, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/shared%40testfirma.example/sendMail");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    const body = JSON.parse(init.body as string);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "max@testfirma.example" } }]);
    expect(body.message.from.emailAddress.address).toBe("rechnung@testfirma.example");
    expect(body.saveToSentItems).toBe(true);
    const [log] = await sql`select transport, ok, error from mail_log order by created_at desc limit 1`;
    expect(log).toMatchObject({ transport: "graph", ok: true, error: null });
  });

  it("sendet ohne Postfach-Feld aus der Absenderadresse", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await mail.saveMailSettings(actor, { ...settings, graphMailbox: "", clientSecret: "" });
    await mail.sendTestMail(actor);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("/users/rechnung%40testfirma.example/sendMail");
  });

  it("protokolliert einen abgelehnten Versand auf Deutsch, ohne Token oder Secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }), {
            status: 403,
            headers: { "request-id": "req-1" },
          }),
      ),
    );
    await mail.saveMailSettings(actor, { ...settings, clientSecret: "" });
    const result = await mail.sendTestMail(actor);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("darf nicht aus dem Postfach shared@testfirma.example senden");
    const [log] = await sql`select transport, ok, error from mail_log order by created_at desc limit 1`;
    expect(log).toMatchObject({ transport: "graph", ok: false });
    expect(log!.error).toContain("Anfrage-ID req-1");
    expect(JSON.stringify(log)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(log)).not.toContain(SECRET);
  });
});
