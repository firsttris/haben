import { FakeElsterClient, type ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Voranmeldung (Postgres)", () => {
  let vat: typeof import("./vat.ts");
  let db: typeof import("./db/index.ts");
  let crypto: typeof import("./crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const period = { year: 2026, month: 10 };

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("./vat.ts");
    db = await import("./db/index.ts");
    crypto = await import("./crypto.ts");
  });

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate vat_return_submissions, vat_returns, elster_certificates, company`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY')`;
    await db.db.insert(db.schema.elsterCertificates).values({
      filename: "test.pfx",
      ciphertext: crypto.encrypt(Buffer.from("pfx")),
    });
  });

  it("speichert einen Entwurf und rechnet Kz 83", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 290_040, kz86: 0, kz66: 17_355 });
    expect(draft).toMatchObject({ kz81: 290_000, kz83: 37_745, status: "draft" });

    const again = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    expect(again.id).toBe(draft.id);
    expect(again.kz83).toBe(19_000);
  });

  it("protokolliert Änderungen mit Nutzer im Audit-Log", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    const rows = await sql`select actor, action from audit_log where row_id = ${draft.id} order by id`;
    expect(rows.map((r) => r.action)).toEqual(["INSERT"]);
    expect(rows[0]?.actor).toBe(actor);
  });

  it("Testübermittlung schreibt nicht fest", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    const result = await vat.submitReturn(actor, draft.id, new FakeElsterClient(), { kind: "test", pin: "1234" });
    expect(result.ok).toBe(true);
    const [row] = await sql`select status, locked_at from vat_returns where id = ${draft.id}`;
    expect(row).toMatchObject({ status: "draft", locked_at: null });
    const submissions = await vat.submissionsFor([draft.id]);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ kind: "test", ok: true, hasPdf: true });
  });

  /** Wie ERiC: kein simulierter Client, damit die Echtübermittlung durchgeht */
  const liveClient = (): ElsterClient => {
    const fake = new FakeElsterClient();
    return { validate: (xml) => fake.validate(xml), send: (...args) => fake.send(...args), fetchPostfach: (...args) => fake.fetchPostfach(...args) };
  };

  it("simulierter Client darf nicht echt übermitteln", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    await expect(
      vat.submitReturn(actor, draft.id, new FakeElsterClient(), { kind: "send", pin: "1234", herstellerId: "12345" }),
    ).rejects.toThrow(/Ohne ERiC/);
    const [row] = await sql`select status from vat_returns where id = ${draft.id}`;
    expect(row!.status).toBe("draft");
  });

  it("Echtübermittlung schreibt fest; danach sind Änderungen gesperrt", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    await expect(
      vat.submitReturn(actor, draft.id, new FakeElsterClient(), { kind: "send", pin: "1234" }),
    ).rejects.toThrow(/Hersteller-ID/);

    const result = await vat.submitReturn(actor, draft.id, liveClient(), {
      kind: "send",
      pin: "1234",
      herstellerId: "12345",
    });
    expect(result.ok).toBe(true);
    const [row] = await sql`select status, locked_at, transfer_ticket from vat_returns where id = ${draft.id}`;
    expect(row?.status).toBe("sent");
    expect(row?.locked_at).not.toBeNull();
    expect(row?.transfer_ticket).toBe(result.transferTicket);

    await expect(sql`update vat_returns set kz81 = 0 where id = ${draft.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from vat_returns where id = ${draft.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(vat.saveDraft(actor, period, { kz81: 1, kz86: 0, kz66: 0 })).rejects.toThrow(/berichtigte/);
  });

  it("berichtigte Anmeldung übernimmt die Werte und trägt Kz 10", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 500 });
    await vat.submitReturn(actor, draft.id, liveClient(), { kind: "send", pin: "1", herstellerId: "12345" });
    const correction = await vat.createCorrection(actor, period);
    expect(correction).toMatchObject({ berichtigt: true, correctsId: draft.id, kz81: 100_000, kz66: 500 });

    let xml = "";
    const spy: ElsterClient = {
      validate: async (body) => {
        xml = body;
        return new FakeElsterClient().validate(body);
      },
      send: (...args) => new FakeElsterClient().send(...args),
      fetchPostfach: (...args) => new FakeElsterClient().fetchPostfach(...args),
    };
    await vat.submitReturn(actor, correction.id, spy, { kind: "validate" });
    expect(xml).toContain("<Kz10>1</Kz10>");
    expect(xml).toContain("<Steuernummer>9198011310010</Steuernummer>");
  });

  it("fehlgeschlagene Übermittlung wird protokolliert, Anmeldung bleibt Entwurf", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    const failing: ElsterClient = {
      validate: async () => ({ ok: false, code: 610301202, message: "Fehler", responseXml: "", serverResponseXml: "" }),
      send: async () => ({ ok: false, code: 610301202, message: "Fehler", responseXml: "", serverResponseXml: "" }),
      fetchPostfach: async () => ({ ok: false, code: 610301202, message: "Fehler", responseXml: "", serverResponseXml: "", bereitstellungen: [], dateien: [] }),
    };
    const result = await vat.submitReturn(actor, draft.id, failing, { kind: "send", pin: "1", herstellerId: "12345" });
    expect(result.ok).toBe(false);
    const [row] = await sql`select status from vat_returns where id = ${draft.id}`;
    expect(row?.status).toBe("draft");
    await expect(sql`delete from vat_return_submissions`).rejects.toThrow(/nur ergänzt/);
  });

  it("verlangt vollständige Firmendaten", async () => {
    await sql`update company set steuernummer = ''`;
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    await expect(vat.submitReturn(actor, draft.id, new FakeElsterClient(), { kind: "validate" })).rejects.toThrow(
      /Steuernummer fehlt/,
    );
  });
});
