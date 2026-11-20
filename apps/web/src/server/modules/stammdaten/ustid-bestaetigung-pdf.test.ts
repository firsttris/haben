import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Antwort des BZSt als PDF am Kontakt (#1491): /api/ustid-bestaetigung/<id> liefert das PDF nur dem Inhaber, der auch die
 * Karte sieht; die Steuerberatung bekommt es nicht, eine unbekannte Antwort ist „nicht gefunden“.
 */

/** Angemeldetes Konto für die API-Route; ohne echte Sitzung (Better Auth) */
const session = vi.hoisted(() => ({ role: "inhaber" as "inhaber" | "steuerberatung" }));
vi.mock("../../auth.ts", () => ({
  auth: () => ({
    api: {
      getSession: async () => ({
        session: { createdAt: new Date() },
        user: { id: "konto", name: "Konto", email: "konto@example.com", role: session.role },
      }),
    },
  }),
}));

describe.skipIf(!testDatabaseUrl)("Antwort des BZSt als PDF (Postgres)", () => {
  let sql: postgres.Sql;
  let pdf: typeof import("./ustid-bestaetigung-pdf.ts");
  let id: string;

  const get = async (bestaetigung: string) => {
    const { Route } = await import("../../../routes/api/ustid-bestaetigung/$id.ts");
    const handlers = (Route.options.server as { handlers: { GET: (ctx: { request: Request; params: { id: string } }) => Promise<Response> } }).handlers;
    return handlers.GET({ request: new Request(`http://localhost/api/ustid-bestaetigung/${bestaetigung}`), params: { id: bestaetigung } });
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    pdf = await import("./ustid-bestaetigung-pdf.ts");
    await leeren(sql)`truncate ustid_bestaetigungen, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, ust_id) values (1, 'Testfirma', 'DE136695976')`;
    const [kontakt] = await sql<{ id: string }[]>`
      insert into contacts (name, strasse, plz, ort, land, ust_id) values ('Donaublick GmbH', 'Praterstraße 3', '1020', 'Wien', 'AT', 'ATU12345678')
      returning id`;
    const [zeile] = await sql<{ id: string }[]>`
      insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, firmenname, ort, status, anfrage_zeitpunkt,
        erg_firmenname, erg_ort, bzst_id, antwort, created_by)
      values (${kontakt!.id}, 'qualifiziert', 'DE136695976', 'ATU12345678', 'Donaublick GmbH', 'Wien', 'evatr-0000', '2026-11-18T23:30:00+00:00',
        'A', 'A', 'b1', '{"id":"b1","status":"evatr-0000"}', 'test-user')
      returning id`;
    id = zeile!.id;
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("baut das PDF aus der gespeicherten Antwort, mit dem Tag der Anfrage in deutscher Zeit im Dateinamen", async () => {
    const file = await pdf.ustIdBestaetigungPdf(id, "2026-11-20");
    expect(file?.filename).toBe("BZSt-ATU12345678-2026-11-19-qualifiziert.pdf");
    expect(Buffer.from(file!.pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(await pdf.ustIdBestaetigungPdf("00000000-0000-4000-8000-000000000000", "2026-11-20")).toBeNull();
  });

  it("liefert das PDF nur dem Inhaber; die Steuerberatung bekommt es nicht", async () => {
    session.role = "inhaber";
    const response = await get(id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline; /);
    session.role = "steuerberatung";
    const verboten = await get(id);
    expect(verboten.status).toBe(403);
    expect(verboten.headers.get("Content-Type")).not.toBe("application/pdf");
    session.role = "inhaber";
  });

  it("eine unbekannte oder kaputte ID ist nicht gefunden", async () => {
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get("kein-uuid")).status).toBe(404);
  });
});
