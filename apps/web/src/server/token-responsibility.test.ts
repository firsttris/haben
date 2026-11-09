import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Token-Verantwortung und geprüfter Gruppenentzug (Postgres)", () => {
  let database: postgres.Sql;
  let mcp: typeof import("./modules/mcp/index.ts");
  let calendar: typeof import("./modules/finanzamt/index.ts");
  let revoke: typeof import("./sso-callback.ts").revokeRejectedIdentity;
  const issuer = "https://idp.example.de";
  const proof = (subject: string) => ({ issuer, subject, accountId: JSON.stringify([issuer, subject]), checkedAt: new Date(), rejection: "keine" as const });
  const bearer = (token: string) => new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer ${token}` } });
  beforeAll(async () => {
    vi.stubEnv("OIDC_ONLY", "true");
    vi.stubEnv("OIDC_ISSUER", issuer);
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    vi.stubEnv("OIDC_CLIENT_SECRET", "test");
    vi.stubEnv("OIDC_GROUP_INHABER", "owner");
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "staff");
    database = await setupTestDb();
    mcp = await import("./modules/mcp/index.ts");
    calendar = await import("./modules/finanzamt/index.ts");
    ({ revokeRejectedIdentity: revoke } = await import("./sso-callback.ts"));
    await database`insert into "user"(id,name,email,role) values ('a','A','a@example.de',null),('b','B','b@example.de',null),('staff','StB','s@example.de',null)`;
    for (const id of ["a", "b", "staff"])
      await database`insert into account(id,account_id,provider_id,user_id) values(${id},${JSON.stringify([issuer, id])},'oidc',${id})`;
  }, 60_000);
  beforeEach(async () => {
    await database`truncate mcp_calls,mcp_tokens,company cascade`;
    await database`insert into company(id,name,mcp_enabled) values(1,'Testfirma',true)`;
    for (const id of ["a", "b", "staff"])
      await database`insert into sso_roles(user_id,issuer,role,confirmed_at) values(${id},${issuer},${id === "staff" ? "steuerberatung" : "inhaber"},now()) on conflict(user_id,issuer) do update set role=excluded.role,confirmed_at=excluded.confirmed_at`;
  });
  afterAll(async () => {
    await database?.end();
    await (await import("./db/index.ts")).closeDatabase();
    vi.unstubAllEnvs();
  });
  const create = (actor = "a") => mcp.createMcpToken({ name: "Automation", days: 30 }, new Date(), actor);

  it("deaktiviert bei Entzug API/MCP und Kalender ohne Änderung der Geheimnisse", async () => {
    const token = await create();
    const urlToken = await calendar.createCalendarToken("a");
    const [before] = await database`select token_hash,expires_at,scopes from mcp_tokens where id=${token.id}`;
    const [calendarBefore] = await database`select calendar_token_hash from company`;
    expect(await mcp.authenticateMcp(bearer(token.token))).not.toBeNull();
    await revoke(proof("a"));
    expect(await mcp.authenticateMcp(bearer(token.token))).toBeNull();
    expect(await calendar.checkCalendarToken(urlToken)).toBe(false);
    const [after] = await database`select token_hash,expires_at,scopes from mcp_tokens where id=${token.id}`;
    expect(after).toEqual(before);
    expect((await database`select calendar_token_hash from company`)[0]).toEqual(calendarBefore);
    expect((await mcp.listMcpTokens())[0]).toMatchObject({ status: "deaktiviert", createdBy: "a", responsibleId: "a" });
  });
  it("überträgt Verantwortung auf einen anderen Inhaber und aktiviert denselben Token", async () => {
    const token = await create();
    const cal = await calendar.createCalendarToken("a");
    await revoke(proof("a"));
    await mcp.reactivateMcpToken("b", token.id);
    await calendar.reactivateCalendarToken("b");
    expect(await mcp.authenticateMcp(bearer(token.token))).not.toBeNull();
    expect(await calendar.checkCalendarToken(cal)).toBe(true);
    expect((await mcp.listMcpTokens())[0]).toMatchObject({ createdBy: "a", responsibleId: "b", status: "aktiv" });
    await revoke(proof("a"));
    expect(await mcp.authenticateMcp(bearer(token.token))).not.toBeNull();
    await revoke(proof("b"));
    expect(await mcp.authenticateMcp(bearer(token.token))).toBeNull();
    expect(await calendar.checkCalendarToken(cal)).toBe(false);
  });
  it("aktiviert nach Rückkehr der Gruppe nicht automatisch und verbietet eigene Übernahme", async () => {
    const token = await create();
    await revoke(proof("a"));
    await database`update sso_roles set role='inhaber',confirmed_at=now() where user_id='a'`;
    await expect(mcp.reactivateMcpToken("a", token.id)).rejects.toThrow(/anderer/);
    expect(await mcp.authenticateMcp(bearer(token.token))).toBeNull();
  });
  it("lässt Tokens nach 30 Tagen ohne SSO-Bestätigung des Verantwortlichen nicht mehr gelten, ohne Anmeldung reicht kein Rollenentzug", async () => {
    const token = await create();
    const cal = await calendar.createCalendarToken("a");
    await database`update sso_roles set confirmed_at=now()-interval '31 days' where user_id='a'`;
    expect(await mcp.authenticateMcp(bearer(token.token))).toBeNull();
    expect(await calendar.checkCalendarToken(cal)).toBe(false);
    expect(await calendar.calendarTokenActive()).toBe(false);
    expect((await mcp.listMcpTokens())[0]).toMatchObject({ status: "unbestaetigt", responsibleId: "a" });
    // Meldet sich der Verantwortliche wieder an, gilt derselbe Zugang ohne weiteres weiter
    await database`update sso_roles set confirmed_at=now() where user_id='a'`;
    expect(await mcp.authenticateMcp(bearer(token.token))).not.toBeNull();
    expect(await calendar.checkCalendarToken(cal)).toBe(true);
  });
  it("lässt Tokens eines Kontos ohne Identität in der Betriebsart nicht gelten; ein aktueller Inhaber kann sie übernehmen", async () => {
    await database`insert into "user"(id,name,email,role) values('lokal','Lokal','lokal@example.de','inhaber') on conflict do nothing`;
    const [row] = await database`insert into mcp_tokens(name,token_hash,prefix,scopes,expires_at,created_by,responsible_id)
      values('Alt','hash-alt','hb_alt',${["haben:lesen"]},now()+interval '30 days','lokal','lokal') returning id`;
    await database`update company set calendar_token_hash=repeat('a',64),calendar_token_responsible_id='lokal'`;
    expect((await mcp.listMcpTokens(new Date(), "a"))[0]).toMatchObject({ status: "unbestaetigt", canTakeOver: true });
    expect(await calendar.calendarTokenStatus("a")).toMatchObject({ ownerConfirmed: false, canTakeOver: true });
    expect(await calendar.calendarTokenActive()).toBe(false);
    await mcp.reactivateMcpToken("a", row!.id);
    await calendar.reactivateCalendarToken("a");
    expect((await mcp.listMcpTokens())[0]).toMatchObject({ status: "aktiv", responsibleId: "a" });
    expect(await calendar.calendarTokenActive()).toBe(true);
  });
  it("erlaubt dem einzigen aktuellen Inhaber die Reaktivierung eigener Tokens", async () => {
    const token = await create();
    await calendar.createCalendarToken("a");
    await revoke(proof("a"));
    await database`update sso_roles set role='inhaber',confirmed_at=now() where user_id='a'`;
    await database`update sso_roles set role=null where user_id='b'`;
    expect((await mcp.listMcpTokens(new Date(), "a"))[0]).toMatchObject({ status: "deaktiviert", canTakeOver: true });
    expect(await calendar.calendarTokenStatus("a")).toMatchObject({ canTakeOver: true });
    await mcp.reactivateMcpToken("a", token.id);
    await calendar.reactivateCalendarToken("a");
    expect(await mcp.authenticateMcp(bearer(token.token))).not.toBeNull();
    expect((await database`select calendar_token_disabled_at from company`)[0]!.calendar_token_disabled_at).toBeNull();
  });
  it("zählt einen seit 30 Tagen unbestätigten Inhaber nicht als anderen Inhaber", async () => {
    const token = await create();
    await revoke(proof("a"));
    await database`update sso_roles set role='inhaber',confirmed_at=now() where user_id='a'`;
    await database`update sso_roles set confirmed_at=now()-interval '31 days' where user_id='b'`;
    await expect(mcp.reactivateMcpToken("a", token.id)).resolves.toBeUndefined();
  });
  it("übernimmt keinen aktiven Token mit gültigem Verantwortlichen", async () => {
    const token = await create();
    await expect(mcp.reactivateMcpToken("b", token.id)).rejects.toThrow(/deaktivierter/);
  });
  it("verbietet Steuerberatung und unbekannten Konten die Übernahme", async () => {
    const token = await create();
    await revoke(proof("a"));
    await expect(mcp.reactivateMcpToken("staff", token.id)).rejects.toThrow(/Inhaber/);
    await expect(mcp.reactivateMcpToken("fremd", token.id)).rejects.toThrow(/Inhaber/);
  });
  it("reaktiviert weder widerrufene noch abgelaufene Tokens", async () => {
    const token = await create();
    await revoke(proof("a"));
    await mcp.revokeMcpToken(token.id);
    await expect(mcp.reactivateMcpToken("b", token.id)).rejects.toThrow(/gültiger/);
    const expired = await create("b");
    await revoke(proof("b"));
    await database`update mcp_tokens set expires_at=now()-interval '1 minute' where id=${expired.id}`;
    await database`update sso_roles set role='inhaber',confirmed_at=now() where user_id='a'`;
    await expect(mcp.reactivateMcpToken("a", expired.id)).rejects.toThrow(/gültiger/);
  });
  it("lässt fremde Verantwortlichkeiten unverändert und protokolliert ohne Tokenhash", async () => {
    const one = await create();
    const two = await create("b");
    await revoke(proof("a"));
    expect(await mcp.authenticateMcp(bearer(two.token))).not.toBeNull();
    const events = await database`select * from token_events where token_id=${one.id}`;
    expect(events.map((e) => e.action)).toEqual(["angelegt", "deaktiviert"]);
    expect(JSON.stringify(events)).not.toContain(one.token);
    await expect(database`delete from token_events`).rejects.toThrow();
  });
  it("verliert bei gleichzeitiger Übernahme und erneutem altem Entzug keine Verantwortung", async () => {
    const token = await create();
    await revoke(proof("a"));
    await Promise.all([mcp.reactivateMcpToken("b", token.id), revoke(proof("a"))]);
    expect((await mcp.listMcpTokens())[0]).toMatchObject({ responsibleId: "b", status: "aktiv" });
  });
});
