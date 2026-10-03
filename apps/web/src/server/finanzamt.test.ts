import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Nachrichten an das Finanzamt (Postgres)", () => {
  let finanzamt: typeof import("./finanzamt.ts");
  let elster: typeof import("@haben/elster");
  let crypto: typeof import("./crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    finanzamt = await import("./finanzamt.ts");
    elster = await import("@haben/elster");
    crypto = await import("./crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate elster_certificates, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, versteuerung, kontenrahmen, einkunftsart)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', 'ist', 'SKR03', 'selbstaendig')`;
  });

  const antrag = { topic: "vorauszahlung" as const, betreff: "Antrag auf Herabsetzung", text: "Bitte herabsetzen.", figures: { wanted: 100_000 } };

  it("prüft und sendet testweise, speichert Text, Werte und XML", async () => {
    const client = new elster.FakeElsterClient();
    expect((await finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).ok).toBe(true);
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "test", pin: "1234" })).rejects.toThrow(/Zertifikat/);
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
    const tested = await finanzamt.sendMessage(actor, antrag, client, { kind: "test", pin: "1234" });
    expect(tested.ok).toBe(true);
    expect(tested.pdf).toBeUndefined();
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "send", pin: "1234", herstellerId: "12345" })).rejects.toThrow(/Ohne ERiC/);

    const rows = await sql`select topic, kind, ok, figures, request_xml from elster_messages order by created_at`;
    expect(rows.map((r) => [r.topic, r.kind, r.ok])).toEqual([
      ["vorauszahlung", "validate", true],
      ["vorauszahlung", "test", true],
    ]);
    expect(rows[0]!.figures).toEqual({ wanted: 100_000 });
    expect(rows[1]!.request_xml).toContain("<Betreff>Antrag auf Herabsetzung</Betreff>");
    expect(rows[1]!.request_xml).toContain("<Hausnummer>1</Hausnummer>");
    expect((await finanzamt.listMessages()).map((m) => m.kind)).toEqual(["test", "validate"]);
    await expect(sql`delete from elster_messages`).rejects.toThrow();
  });

  it("lehnt leere Nachrichten und Anschriften ohne Hausnummer ab", async () => {
    const client = new elster.FakeElsterClient();
    await expect(finanzamt.sendMessage(actor, { ...antrag, betreff: " " }, client, { kind: "validate" })).rejects.toThrow(/Betreff/);
    await sql`update company set strasse = 'Am Markt'`;
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).rejects.toThrow(/Hausnummer/);
  });

  it("rechnet den Gewinn aufs Jahr hoch", async () => {
    const basis = await finanzamt.prepaymentBasis("2026-07-02");
    expect(basis).toMatchObject({ year: 2026, until: "2026-07-02", profitSoFar: 0, profitForecast: 0, einkunftsart: "selbstaendig" });
  });
});
