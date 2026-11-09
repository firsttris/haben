import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf } from "./sso-test-provider.ts";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

/*
 * Opt-in gegen eine isolierte Authelia-Instanz (docs/entwicklung.md, „Mit Authelia“): Benutzer `inhaberin` und
 * `kanzlei` mit dem Passwort unten und dem synthetischen TOTP-Schlüssel, Gruppen in AUTHELIA_TEST_USERS_FILE als
 * `groups: [...]` je Benutzer. Der Test ändert die Gruppen bei bestehender Authelia-Sitzung. Nur Testwerte.
 */
const issuer = process.env.AUTHELIA_TEST_ISSUER;
const usersFile = process.env.AUTHELIA_TEST_USERS_FILE;
const PASSWORD = "ein-sehr-langes-authelia-testpasswort";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** RFC 6238 mit SHA-1, 30 Sekunden, 6 Stellen */
function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return String((digest.readUInt32BE(digest[digest.length - 1]! & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe.skipIf(!issuer || !usersFile || !testDatabaseUrl)("Authelia-Referenzintegration im SSO-Modus", () => {
  let database: postgres.Sql;
  let handleAuth: typeof import("./auth.ts").handleAuth;
  let sessionUser: typeof import("./rollen.ts").sessionUser;
  let originalUsers = "";
  /** Cookie-Speicher je Authelia-Benutzer: die Authelia-Sitzung bleibt zwischen den Haben-Anmeldungen bestehen */
  const jars = new Map<string, Map<string, string>>();
  /** Eigene Adresse je Anmeldung, damit das Rate-Limit von Better Auth den Test nicht ausbremst */
  let client = 0;

  async function provider(user: string, path: string, data?: unknown) {
    const jar = jars.get(user) ?? new Map<string, string>();
    jars.set(user, jar);
    const response = await fetch(new URL(path, issuer), {
      method: data ? "POST" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        origin: issuer!,
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const equal = pair.indexOf("=");
      jar.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    return response;
  }

  /** Passwort und TOTP bei Authelia; danach genügt die Authelia-Sitzung */
  async function autheliaLogin(user: string) {
    const first = await provider(user, "/api/firstfactor", { username: user, password: PASSWORD, keepMeLoggedIn: false });
    expect(first.status, await first.text()).toBe(200);
    const second = await provider(user, "/api/secondfactor/totp", { token: totp(TOTP_SECRET) });
    expect(second.status, await second.text()).toBe(200);
  }

  /** Ein vollständiger Haben-Durchlauf mit der bestehenden Authelia-Sitzung des Benutzers */
  async function habenLogin(user: string) {
    const start = await handleAuth(
      new Request("http://localhost:3000/api/auth/sign-in/social", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": `127.4.0.${++client}` },
        body: JSON.stringify({ provider: "oidc" }),
      }),
    );
    expect(start.status, await start.clone().text()).toBe(200);
    const url = new URL((await start.json()).url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toContain("groups");
    const authorization = await provider(user, url.toString());
    expect([302, 303], await authorization.clone().text()).toContain(authorization.status);
    const callback = authorization.headers.get("location")!;
    expect(new URL(callback).origin).toBe("http://localhost:3000");
    const response = await handleAuth(new Request(callback, { headers: { cookie: cookieOf(start.headers) } }));
    return {
      response,
      cookie: cookieOf(response.headers),
      reason: new URL(response.headers.get("location") ?? "/", "http://localhost").searchParams.get("sso"),
    };
  }

  /** Gruppen in der Benutzerdatei ändern; Authelia liest sie mit watch und refresh_interval: always neu */
  async function setGroups(user: string, groups: string[]) {
    const text = await readFile(usersFile!, "utf8");
    const pattern = new RegExp(`(\\n  ${user}:[\\s\\S]*?\\n    groups: )\\[[^\\]]*\\]`);
    expect(pattern.test(text)).toBe(true);
    await writeFile(usersFile!, text.replace(pattern, `$1[${groups.join(", ")}]`));
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }

  const userId = async (email: string) => (await database`select id from "user" where email = ${email}`)[0]?.id as string | undefined;
  const sessionCount = async (id: string) => (await database`select count(*)::int as n from session where user_id = ${id}`)[0]!.n as number;

  beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(issuer!).hostname) && !new URL(issuer!).hostname.endsWith(".test"))
      throw new Error("Authelia-Test nur gegen eine Testinstanz (Loopback oder .test).");
    originalUsers = await readFile(usersFile!, "utf8");
    Object.assign(process.env, {
      OIDC_ONLY: "true",
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: "haben",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_DISPLAY_NAME: "Authelia",
      OIDC_GROUP_INHABER: "haben-inhaber",
      OIDC_GROUP_STEUERBERATUNG: "haben-steuerberatung",
    });
    database = await setupTestDb();
    ({ handleAuth } = await import("./auth.ts"));
    ({ sessionUser } = await import("./rollen.ts"));
  }, 60_000);
  afterAll(async () => {
    if (originalUsers) await writeFile(usersFile!, originalUsers);
    await database?.end();
    const { closeDatabase } = await import("./db/index.ts");
    await closeDatabase();
  });

  it("richtet nur mit der Inhaber-Gruppe ein und legt die Steuerberatung danach automatisch an", async () => {
    await autheliaLogin("kanzlei");
    expect((await habenLogin("kanzlei")).reason).toBe("nicht-eingerichtet");
    expect(await userId("kanzlei@haben.test")).toBeUndefined();

    // Nächstes TOTP-Fenster: Authelia nimmt denselben Code nicht zweimal
    await new Promise((resolve) => setTimeout(resolve, 31_000 - (Date.now() % 30_000)));
    await autheliaLogin("inhaberin");
    const owner = await habenLogin("inhaberin");
    expect(owner.reason).toBeNull();
    expect(await sessionUser(new Headers({ cookie: owner.cookie }))).toMatchObject({ role: "inhaber" });

    const staff = await habenLogin("kanzlei");
    expect(staff.reason).toBeNull();
    expect(await sessionUser(new Headers({ cookie: staff.cookie }))).toMatchObject({ role: "steuerberatung" });
    const [account] =
      await database`select account_id, access_token, refresh_token, id_token from account where user_id = ${(await userId("kanzlei@haben.test"))!}`;
    expect(JSON.parse(account!.account_id)[0]).toBe(issuer);
    expect(account).toMatchObject({ access_token: null, refresh_token: null, id_token: null });
  }, 90_000);

  it("übernimmt geänderte Gruppen bei bestehender Authelia-Sitzung und widerruft beim Entzug", async () => {
    const id = (await userId("kanzlei@haben.test"))!;
    const before = await habenLogin("kanzlei");
    expect(await sessionUser(new Headers({ cookie: before.cookie }))).toMatchObject({ role: "steuerberatung" });

    await setGroups("kanzlei", ["haben-inhaber"]);
    const promoted = await habenLogin("kanzlei");
    expect(promoted.reason).toBeNull();
    expect(await sessionUser(new Headers({ cookie: promoted.cookie }))).toMatchObject({ role: "inhaber" });
    expect(await sessionUser(new Headers({ cookie: before.cookie }))).toBeNull();
    expect(await sessionCount(id)).toBe(1);

    await setGroups("kanzlei", ["familie"]);
    const rejected = await habenLogin("kanzlei");
    expect(rejected.reason).toBe("gruppe");
    expect(await sessionCount(id)).toBe(0);
    expect(await sessionUser(new Headers({ cookie: promoted.cookie }))).toBeNull();

    await setGroups("kanzlei", ["haben-inhaber", "haben-steuerberatung"]);
    expect((await habenLogin("kanzlei")).reason).toBe("gruppe");

    await setGroups("kanzlei", ["haben-steuerberatung"]);
    const back = await habenLogin("kanzlei");
    expect(await sessionUser(new Headers({ cookie: back.cookie }))).toMatchObject({ role: "steuerberatung" });
    const roles =
      await database`select new_value ->> 'role' as role from audit_log where table_name = 'sso_roles' and new_value ->> 'user_id' = ${id} order by seq`;
    expect(roles.map((row) => row.role)).toEqual(["steuerberatung", "steuerberatung", "inhaber", null, null, "steuerberatung"]);
  }, 90_000);
});
