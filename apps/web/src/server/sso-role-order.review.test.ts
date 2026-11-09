import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("SSO-Entscheidungsreihenfolge (unabhängiges Review)", () => {
  let database: postgres.Sql;
  const issuer = "https://idp.example.de";
  beforeAll(async () => {
    vi.stubEnv("OIDC_ONLY", "true");
    vi.stubEnv("OIDC_ISSUER", issuer);
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    vi.stubEnv("OIDC_CLIENT_SECRET", "test");
    vi.stubEnv("OIDC_GROUP_INHABER", "owner");
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "staff");
    database = await setupTestDb();
    await database`insert into "user"(id,name,email,role) values ('owner','Inhaber','owner@example.de',null)`;
    await database`insert into account(id,account_id,provider_id,user_id) values('owner',${JSON.stringify([issuer, "owner"])},'oidc','owner')`;
    await database`insert into sso_issuers(issuer,initialized_by) values(${issuer},'owner')`;
    await database`insert into company(id,name,mcp_enabled) values(1,'Testfirma',true)`;
  }, 60_000);
  afterAll(async () => {
    await database?.end();
    await (await import("./db/index.ts")).closeDatabase();
    vi.unstubAllEnvs();
  });

  it("lässt einen älteren Inhaber-Nachweis nach neuerem Gruppenentzug keine Tokens anlegen", async () => {
    const { atomicAuthCallback, setCallbackProof } = await import("./auth-transaction.ts");
    const { confirmSsoSession, revokeRejectedIdentity } = await import("./sso-callback.ts");
    const { createMcpToken } = await import("./modules/mcp/index.ts");
    const checkedAt = new Date(Date.now() - 1_000);
    const identity = { issuer, subject: "owner", accountId: JSON.stringify([issuer, "owner"]) };
    // Der Netzwerk-/DB-Abschluss zweier vollständig geprüfter Callbacks darf vertauscht sein.
    await revokeRejectedIdentity({ ...identity, checkedAt: new Date(), rejection: "keine" });
    await atomicAuthCallback(
      async () => {
        setCallbackProof({ ...identity, checkedAt, role: "inhaber", expiresAt: new Date(Date.now() + 60_000) });
        await confirmSsoSession("owner");
        return new Response(null, { status: 302, headers: { location: "/" } });
      },
      { errorUrl: () => "http://localhost/login?sso=fehler" },
    );
    await expect(createMcpToken({ name: "Nach Entzug", days: 30 }, new Date(), "owner")).rejects.toThrow(/Inhaber/);
  });

  it("ignoriert älteren negativen Nachweis nach neuerer Inhaber-Bestätigung", async () => {
    const { atomicAuthCallback, setCallbackProof } = await import("./auth-transaction.ts");
    const { confirmSsoSession, revokeRejectedIdentity } = await import("./sso-callback.ts");
    const { createMcpToken, authenticateMcp } = await import("./modules/mcp/index.ts");
    const checkedAt = new Date();
    const identity = { issuer, subject: "owner", accountId: JSON.stringify([issuer, "owner"]) };
    await atomicAuthCallback(
      async () => {
        setCallbackProof({ ...identity, checkedAt, role: "inhaber", expiresAt: new Date(Date.now() + 60_000) });
        await confirmSsoSession("owner");
        return new Response(null, { status: 302, headers: { location: "/" } });
      },
      { errorUrl: () => "http://localhost/login?sso=fehler" },
    );
    const token = await createMcpToken({ name: "Weiter gültig", days: 30 }, new Date(), "owner");
    await revokeRejectedIdentity({ ...identity, checkedAt: new Date(checkedAt.getTime() - 1_000), rejection: "keine" });
    expect(await authenticateMcp(new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer ${token.token}` } }))).not.toBeNull();
  });
});
