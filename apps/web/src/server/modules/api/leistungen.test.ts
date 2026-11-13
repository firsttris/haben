import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * REST-API für Leistungseinträge (#417): Zeiterfassungsprogramme (Kimai, Toggl) schicken ihre Einträge an /api/v1/leistungen.
 * Mit Quelle und Kennung ist der Aufruf idempotent. Eigene Rechte leistungen:lesen und leistungen:schreiben.
 */

describe.skipIf(!testDatabaseUrl)("REST-API /api/v1/leistungen (Postgres, #417)", () => {
  let api: typeof import("./index.ts");
  let mcp: typeof import("../mcp/index.ts");
  let mcpServer: typeof import("../mcp/server.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    mcp = await import("../mcp/index.ts");
    mcpServer = await import("../mcp/server.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    mcpServer.resetRateLimitForTests();
    await leeren(sql)`truncate mcp_calls, mcp_tokens, service_entries, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    [{ id: contactId }] = (await sql`insert into contacts (name, hourly_rate_cents) values ('Nordwerk Software GmbH', 9500) returning id`) as unknown as [
      { id: string },
    ];
  });

  type Scope = import("../mcp/index.ts").TokenScope;
  async function token(scopes: Scope[]) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "Kimai", days: 30, scopes }, new Date(), actor)).token;
  }

  async function call(tokenValue: string, method: string, path: string, body?: unknown) {
    const response = await api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${tokenValue}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as { id: string; error?: { message: string }; [key: string]: unknown }) : null };
  }

  const eintrag = (extra: Record<string, unknown> = {}) => ({ contactId, workedOn: "2026-03-02", minutes: 90, description: "Konzept", ...extra });

  it("legt einen Eintrag an (201), liest ihn in der Liste und löscht ihn (204)", async () => {
    const t = await token(["leistungen:schreiben"]);
    const created = await call(t, "POST", "/leistungen", eintrag());
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ contactId, workedOn: "2026-03-02", minutes: 90, hourlyRateCents: 9500, source: null, externalId: null });
    const list = await call(t, "GET", `/leistungen?contactId=${contactId}&from=2026-03-01&to=2026-03-31`);
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ total: 1, data: [{ id: created.json!.id }] });
    expect((await call(t, "DELETE", `/leistungen/${created.json!.id}`)).status).toBe(204);
    expect((await call(t, "DELETE", `/leistungen/${created.json!.id}`)).status).toBe(404);
  });

  it("Location nach dem Anlegen führt zum Eintrag", async () => {
    const t = await token(["leistungen:schreiben"]);
    const response = await api.handleApiRequest(
      new Request("http://localhost:3000/api/v1/leistungen", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(eintrag()),
      }),
    );
    expect(response.status).toBe(201);
    const location = response.headers.get("Location")!;
    const { id } = (await response.json()) as { id: string };
    const read = await call(t, "GET", location.replace("/api/v1", ""));
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ id, minutes: 90, hourlyRateCents: 9500 });
    expect((await call(await token(["leistungen:lesen"]), "GET", location.replace("/api/v1", ""))).status).toBe(200);
    expect((await call(t, "GET", "/leistungen/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("nicht abrechenbar, abrechenbare Dauer und Projekt gehen hin und kommen zurück", async () => {
    const t = await token(["leistungen:schreiben"]);
    const plain = await call(t, "POST", "/leistungen", eintrag());
    expect(plain.json).toMatchObject({ nonBillable: false, billableMinutes: null, project: "" });
    const full = await call(
      t,
      "POST",
      "/leistungen",
      eintrag({ nonBillable: true, billableMinutes: 60, project: "Relaunch Shop", source: "kimai", externalId: "9" }),
    );
    expect(full.json).toMatchObject({ nonBillable: true, billableMinutes: 60, project: "Relaunch Shop" });
    // derselbe Aufruf ohne die Felder lässt sie stehen
    const again = await call(t, "POST", "/leistungen", eintrag({ source: "kimai", externalId: "9", minutes: 95 }));
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ minutes: 95, nonBillable: true, billableMinutes: 60, project: "Relaunch Shop" });
    expect((await call(t, "POST", "/leistungen", eintrag({ billableMinutes: 0 }))).status).toBe(400);
  });

  it("nimmt nur Kunden: ein reiner Lieferant ist 422", async () => {
    const t = await token(["leistungen:schreiben"]);
    const [lieferant] = await sql`insert into contacts (name, is_customer, is_supplier) values ('Papier AG', false, true) returning id`;
    const r = await call(t, "POST", "/leistungen", eintrag({ contactId: lieferant!.id }));
    expect(r.status).toBe(422);
    expect(r.json!.error?.message).toBe("Der Kontakt ist kein Kunde.");
  });

  it("mit Quelle und Kennung: 201 beim ersten, 200 beim zweiten Aufruf, ein Eintrag", async () => {
    const t = await token(["leistungen:schreiben"]);
    const first = await call(t, "POST", "/leistungen", eintrag({ source: "kimai", externalId: "4711" }));
    const second = await call(t, "POST", "/leistungen", eintrag({ source: "kimai", externalId: "4711", minutes: 100 }));
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.json).toMatchObject({ id: first.json!.id, minutes: 100, source: "kimai", externalId: "4711" });
    expect((await call(t, "GET", "/leistungen")).json!.total).toBe(1);
  });

  it("lehnt Quelle ohne Kennung, unbekannte Felder und einen fremden Kunden ab", async () => {
    const t = await token(["leistungen:schreiben"]);
    expect((await call(t, "POST", "/leistungen", eintrag({ source: "kimai" }))).status).toBe(400);
    expect((await call(t, "POST", "/leistungen", eintrag({ foo: 1 }))).status).toBe(400);
    expect((await call(t, "POST", "/leistungen", eintrag({ minutes: 0 }))).status).toBe(400);
    const missing = await call(t, "POST", "/leistungen", eintrag({ contactId: "00000000-0000-4000-8000-000000000000" }));
    expect(missing.status).toBe(422);
    expect(missing.json!.error?.message).toBe("Kunde nicht gefunden.");
  });

  it("Rechte: lesen genügt für die Liste, nicht zum Schreiben; andere Rechte reichen nicht", async () => {
    const lesen = await token(["leistungen:lesen"]);
    expect((await call(lesen, "GET", "/leistungen")).status).toBe(200);
    expect((await call(lesen, "POST", "/leistungen", eintrag())).status).toBe(403);
    expect((await call(lesen, "DELETE", "/leistungen/00000000-0000-4000-8000-000000000000")).status).toBe(403);
    const kontakte = await token(["kontakte:schreiben"]);
    expect((await call(kontakte, "GET", "/leistungen")).status).toBe(403);
    // schreiben schließt lesen ein
    expect((await call(await token(["leistungen:schreiben"]), "GET", "/leistungen")).status).toBe(200);
  });

  it("ein Eintrag auf einer Rechnung: Rechnung in der Antwort, Filter nach Stand, Löschen abgelehnt, erneutes POST ändert nichts", async () => {
    const t = await token(["leistungen:schreiben"]);
    const created = await call(t, "POST", "/leistungen", eintrag({ source: "kimai", externalId: "9" }));
    const { billServiceEntries } = await import("../leistungen/index.ts");
    const { invoiceId } = await billServiceEntries(actor, { contactId, from: "2026-03-01", to: "2026-03-31" }, "2026-04-01");

    const eins = await call(t, "GET", `/leistungen/${created.json!.id}`);
    expect(eins.json).toMatchObject({ invoiceId, invoiceNumber: null, invoiceStatus: "draft" });
    expect(await call(t, "GET", "/leistungen?status=offen")).toMatchObject({ json: { total: 0 } });
    expect(await call(t, "GET", "/leistungen?status=abgerechnet")).toMatchObject({ json: { total: 1 } });

    const gelöscht = await call(t, "DELETE", `/leistungen/${created.json!.id}`);
    expect(gelöscht.status).toBe(422);
    expect(gelöscht.json!.error!.message).toMatch(/Rechnungsentwurf/);

    const erneut = await call(t, "POST", "/leistungen", eintrag({ source: "kimai", externalId: "9", minutes: 600 }));
    expect(erneut.status).toBe(200);
    expect(erneut.json).toMatchObject({ minutes: 90, invoiceId });
  });

  it("der Akteur im Audit-Log ist das Token", async () => {
    const t = await token(["leistungen:schreiben"]);
    const created = await call(t, "POST", "/leistungen", eintrag());
    const [row] = await sql`select actor from audit_log where table_name = 'service_entries' and row_id = ${created.json!.id}`;
    expect(row!.actor).toMatch(/^api:.*:Kimai$/);
  });

  it("der Stundensatz am Kontakt lässt sich über die Kontakt-API setzen", async () => {
    const t = await token(["kontakte:schreiben"]);
    const patched = await call(t, "PATCH", `/kontakte/${contactId}`, { hourlyRateCents: 11000 });
    expect(patched.status).toBe(200);
    // und liest ihn zurück
    expect((await call(t, "GET", `/kontakte/${contactId}`)).json).toMatchObject({ hourlyRateCents: 11000 });
    const [row] = await sql`select hourly_rate_cents from contacts where id = ${contactId}`;
    expect(row!.hourly_rate_cents).toBe(11000);
  });
});
