import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Zugang der Steuerberatung (Roadmap Platz 10, Stufe 1) gegen eine echte Datenbank: Einladung statt Selbst-Registrieren,
 * Rechteprüfung der Middleware für beide Rollen, Sperren und Entfernen, Audit je Nutzer und Anmeldeprotokoll.
 */

// Die Middleware liest die Kopfzeilen der laufenden Anfrage; im Test kommen sie von hier
const request = vi.hoisted(() => ({ headers: new Headers(), status: 200 }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => request.headers,
  setResponseStatus: (status: number) => {
    request.status = status;
  },
}));

describe.skipIf(!testDatabaseUrl)("Zugang der Steuerberatung (Postgres)", () => {
  let sql: postgres.Sql;
  let auth: typeof import("../../auth.ts").auth;
  let zugang: typeof import("./index.ts");
  let middleware: typeof import("../../middleware.ts");
  let actor: typeof import("../../db/actor.ts");
  let setupCode: string;
  let ownerId: string;
  let ownerCookie: string;

  const password = "ein-sehr-langes-passwort";

  /** Legt ein Konto an und gibt seine ID und das Sitzungscookie zurück */
  async function signUp(email: string, headers: Record<string, string>) {
    const { headers: response, response: body } = await auth().api.signUpEmail({
      body: { name: email.split("@")[0]!, email, password },
      headers: new Headers(headers),
      returnHeaders: true,
    });
    return { id: body.user.id, cookie: cookieOf(response) };
  }

  async function signIn(email: string) {
    const { headers } = await auth().api.signInEmail({ body: { email, password }, headers: new Headers(), returnHeaders: true });
    return cookieOf(headers);
  }

  const cookieOf = (headers: Headers) =>
    headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

  /** Führt die Middleware wie TanStack Start aus und liefert, was der Handler zurückgibt, oder den Fehler für den Browser */
  async function call(mw: typeof middleware.authMiddleware, cookie: string, handler: (user: { id: string; role: string }) => Promise<unknown>) {
    request.headers = new Headers({ cookie });
    request.status = 200;
    const server = (mw as unknown as { options: { server: (opts: unknown) => Promise<unknown> } }).options.server;
    try {
      const result = await server({
        next: async ({ context }: { context: { user: { id: string; role: string } } }) => ({ result: await handler(context.user) }),
      });
      return { ok: true as const, result: (result as { result: unknown }).result };
    } catch (error) {
      return { ok: false as const, status: request.status, message: (error as Error).message };
    }
  }

  async function invite(label = "Kanzlei Muster") {
    return zugang.createInvitation(ownerId, { label });
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    ({ auth } = await import("../../auth.ts"));
    zugang = await import("./index.ts");
    middleware = await import("../../middleware.ts");
    actor = await import("../../db/actor.ts");
    setupCode = (await import("../../setup-code.ts")).setupCode();
    ({ id: ownerId, cookie: ownerCookie } = await signUp("inhaber@example.de", { "x-haben-setup-code": setupCode }));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("das erste Konto ist der Inhaber; ohne Einladung entsteht kein weiteres, auch nicht mit dem Einrichtungscode", async () => {
    expect(await sql`select role from "user" where id = ${ownerId}`).toEqual([{ role: "inhaber" }]);
    await expect(signUp("zweiter@example.de", { "x-haben-setup-code": setupCode })).rejects.toThrow(/nur per Einladung/);
    await expect(signUp("dritter@example.de", {})).rejects.toThrow(/Einrichtungscode/);
    await expect(signUp("vierter@example.de", { "x-haben-einladung": "erfunden" })).rejects.toThrow(/Einladung ist ungültig/);
    expect(await sql`select count(*)::int as n from "user"`).toEqual([{ n: 1 }]);
  });

  it("eine Einladung gilt genau einmal, nur bis zum Ablauf und nicht nach dem Zurückziehen; gespeichert ist nur ihr Hash", async () => {
    const { token, id } = await invite();
    const [stored] = await sql`select token_hash from invitations where id = ${id}`;
    expect(stored!.token_hash).not.toContain(token);
    expect(stored!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const stb = await signUp("kanzlei@example.de", { "x-haben-einladung": token });
    expect(await sql`select role from "user" where id = ${stb.id}`).toEqual([{ role: "steuerberatung" }]);
    expect(await sql`select accepted_email, user_id from invitations where id = ${id}`).toEqual([{ accepted_email: "kanzlei@example.de", user_id: stb.id }]);
    await expect(signUp("nochmal@example.de", { "x-haben-einladung": token })).rejects.toThrow(/Einladung ist ungültig/);

    const revoked = await invite();
    await zugang.revokeInvitation(ownerId, revoked.id);
    await expect(signUp("zurueck@example.de", { "x-haben-einladung": revoked.token })).rejects.toThrow(/Einladung ist ungültig/);
    await expect(zugang.revokeInvitation(ownerId, revoked.id)).rejects.toThrow(/schon eingelöst oder zurückgezogen/);

    const expired = await zugang.createInvitation(ownerId, { label: "alt" }, new Date(Date.now() - 73 * 3_600_000));
    await expect(signUp("abgelaufen@example.de", { "x-haben-einladung": expired.token })).rejects.toThrow(/Einladung ist ungültig/);

    const states = Object.fromEntries((await zugang.listInvitations()).map((i) => [i.id, i.status]));
    expect([states[id], states[revoked.id], states[expired.id]]).toEqual(["eingeloest", "zurueckgezogen", "abgelaufen"]);
    // Einladungen bleiben im Protokoll: weder löschen noch nachträglich ändern
    await expect(sql`delete from invitations where id = ${id}`).rejects.toThrow(/nicht gelöscht/);
    await expect(sql`update invitations set label = 'anders' where id = ${id}`).rejects.toThrow(/eingelöst oder zurückgezogen/);
  });

  it("die Datenbank hält genau einen Inhaber und ändert keine Rolle", async () => {
    await expect(sql`insert into "user" (id, name, email, role) values ('x', 'X', 'x@example.de', 'inhaber')`).rejects.toThrow(/user_inhaber_single/);
    await expect(sql`insert into "user" (id, name, email, role) values ('y', 'Y', 'y@example.de', 'admin')`).rejects.toThrow(/user_role/);
    await expect(sql`update "user" set role = 'steuerberatung' where id = ${ownerId}`).rejects.toThrow(/Rolle eines Kontos/);
    await expect(
      sql`insert into invitations (token_hash, role, label, created_by, expires_at) values ('h', 'inhaber', 'x', ${ownerId}, now())`,
    ).rejects.toThrow(/invitations_role/);
  });

  it("die Middleware lässt die Steuerberatung nur lesen; jede Änderung wird auch innerhalb einer lesenden Funktion abgelehnt", async () => {
    const { token } = await invite();
    const stb = await signUp("lesen@example.de", { "x-haben-einladung": token });

    // Vorgabe authMiddleware: nur der Inhaber
    expect(await call(middleware.authMiddleware, ownerCookie, async (user) => user.role)).toEqual({ ok: true, result: "inhaber" });
    const denied = await call(middleware.authMiddleware, stb.cookie, async () => "darf nicht laufen");
    expect(denied).toEqual({ ok: false, status: 403, message: "Das darf nur der Inhaber. Die Steuerberatung hat nur Lesezugriff." });

    // readMiddleware: beide, die Steuerberatung aber ohne Schreibrecht
    expect(await call(middleware.readMiddleware, stb.cookie, async (user) => user.role)).toEqual({ ok: true, result: "steuerberatung" });
    const write = () => actor.withActor("irgendwer", (tx) => tx.execute("select 1"));
    expect(await call(middleware.readMiddleware, stb.cookie, write)).toMatchObject({ ok: false, status: 403 });
    expect(await call(middleware.readMiddleware, ownerCookie, write)).toMatchObject({ ok: true });

    // Ohne Sitzung
    expect(await call(middleware.readMiddleware, "", async () => 1)).toMatchObject({ ok: false, status: 401 });
  });

  it("Sperren beendet die Sitzungen und verhindert die Anmeldung; den Inhaber kann man weder sperren noch entfernen", async () => {
    const { token } = await invite();
    const stb = await signUp("gesperrt@example.de", { "x-haben-einladung": token });
    expect(await call(middleware.readMiddleware, stb.cookie, async () => "ok")).toMatchObject({ ok: true });

    await zugang.lockAccount(ownerId, stb.id);
    expect(await sql`select count(*)::int as n from session where user_id = ${stb.id}`).toEqual([{ n: 0 }]);
    expect(await call(middleware.readMiddleware, stb.cookie, async () => "ok")).toMatchObject({ ok: false, status: 401 });
    await expect(signIn("gesperrt@example.de")).rejects.toThrow(/gesperrt/);

    await zugang.unlockAccount(ownerId, stb.id);
    const again = await signIn("gesperrt@example.de");
    expect(await call(middleware.readMiddleware, again, async () => "ok")).toMatchObject({ ok: true });

    await zugang.removeAccount(ownerId, stb.id);
    expect(await sql`select count(*)::int as n from "user" where id = ${stb.id}`).toEqual([{ n: 0 }]);
    expect(await call(middleware.readMiddleware, again, async () => "ok")).toMatchObject({ ok: false, status: 401 });

    await expect(zugang.lockAccount(ownerId, ownerId)).rejects.toThrow(/Inhabers/);
    await expect(zugang.removeAccount(ownerId, ownerId)).rejects.toThrow(/Inhabers/);
  });

  it("über Better Auth ändert niemand sein Konto (update-user): das schriebe ohne Akteur und an der Rollenprüfung vorbei", async () => {
    const { token } = await invite();
    const stb = await signUp("profil@example.de", { "x-haben-einladung": token });
    for (const cookie of [stb.cookie, ownerCookie]) {
      const response = await auth().handler(
        new Request("http://localhost:3000/api/auth/update-user", {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ name: "Anders", image: "https://example.de/bild.png" }),
        }),
      );
      expect(response.status).toBe(403);
    }
    expect(await sql`select name, image from "user" where id in (${stb.id}, ${ownerId}) order by role`).toEqual([
      { name: "inhaber", image: null },
      { name: "profil", image: null },
    ]);
  });

  it("Audit je Nutzer: Konten mit Rolle, Einladungen und jede Anmeldung stehen in der Hash-Kette, ohne Passwort", async () => {
    const { token, id } = await invite("Kanzlei Audit");
    const stb = await signUp("audit@example.de", { "x-haben-einladung": token });
    await signIn("audit@example.de");

    const [created] = await sql`select actor, new_value from audit_log where table_name = 'user' and row_id = ${stb.id} and action = 'INSERT'`;
    expect(created!.new_value).toMatchObject({ email: "audit@example.de", role: "steuerberatung" });
    expect(JSON.stringify(created!.new_value)).not.toContain(password);

    const [invitation] = await sql`select actor from audit_log where table_name = 'invitations' and row_id = ${id} and action = 'INSERT'`;
    expect(invitation!.actor).toBe(ownerId);

    const logins = await sql`select actor, new_value from audit_log where table_name = 'user_logins' and actor = ${stb.id} order by seq`;
    expect(logins.map((l) => (l.new_value as { method: string; role: string }).method)).toEqual(["einrichtung", "passwort"]);
    expect(logins.every((l) => (l.new_value as { role: string }).role === "steuerberatung")).toBe(true);
    await expect(sql`delete from user_logins`).rejects.toThrow();

    // Entfernen schreibt den Inhaber als Akteur ins Protokoll, mit dem gelöschten Konto
    await zugang.removeAccount(ownerId, stb.id);
    const [removed] = await sql`select actor, old_value from audit_log where table_name = 'user' and row_id = ${stb.id} and action = 'DELETE'`;
    expect(removed!.actor).toBe(ownerId);
    expect(removed!.old_value).toMatchObject({ email: "audit@example.de", role: "steuerberatung" });
  });

  it("zeigt der Steuerberatung, was sich seit ihrem letzten Besuch geändert hat", async () => {
    await sql`insert into documents (filename, mime_type, sha256, size) values ('a.pdf', 'application/pdf', ${"a".repeat(64)}, 1)`;
    const { token } = await invite();
    const stb = await signUp("besuch@example.de", { "x-haben-einladung": token });
    // Erster Besuch: nichts zu vergleichen
    expect((await zugang.changesSinceLastVisit(stb.id)).since).toBeNull();

    await sql`insert into documents (filename, mime_type, sha256, size) values ('b.pdf', 'application/pdf', ${"b".repeat(64)}, 1)`;
    await signIn("besuch@example.de");
    // Seit dem vorigen Besuch kam nur b dazu
    const changes = await zugang.changesSinceLastVisit(stb.id);
    expect(changes.since).toBeInstanceOf(Date);
    expect(changes).toMatchObject({ neueBelege: 1, gebuchteBelege: 0, rechnungen: 0, buchungen: 0, rueckwirkend: 0 });
  });

  it("listet die Zugänge, der Inhaber zuerst, mit letzter Anmeldung", async () => {
    const accounts = await zugang.listAccounts();
    expect(accounts[0]).toMatchObject({ id: ownerId, role: "inhaber" });
    expect(accounts.slice(1).every((a) => a.role === "steuerberatung")).toBe(true);
    expect(accounts[0]!.lastLoginAt).toBeInstanceOf(Date);
  });
});
