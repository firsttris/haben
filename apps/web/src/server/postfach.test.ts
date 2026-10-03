import type { ElsterClient, PostfachResult } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("ELSTER-Postfach (Postgres)", () => {
  let postfach: typeof import("./postfach.ts");
  let elster: typeof import("@haben/elster");
  let crypto: typeof import("./crypto.ts");
  let storage: typeof import("./storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    postfach = await import("./postfach.ts");
    elster = await import("@haben/elster");
    crypto = await import("./crypto.ts");
    storage = await import("./storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate elster_certificates, company, postfach_documents, postfach_requests cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland) values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY')`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
  });

  const pdf = (text: string) => new Uint8Array(Buffer.from(`%PDF-1.4 ${text}`));

  /** Postfach mit zwei Bereitstellungen; der zweite Anhang von B2 lässt sich nicht abholen */
  function scriptedClient(options: { confirmOk?: boolean } = {}) {
    const fake = new elster.FakeElsterClient();
    const sent: string[] = [];
    const client: ElsterClient = {
      validate: (xml) => fake.validate(xml),
      send: async (xml, ...rest) => {
        sent.push(xml);
        const result = await fake.send(xml, ...rest);
        return options.confirmOk === false ? { ...result, ok: false, code: 1, message: "Server nicht erreichbar" } : result;
      },
      fetchPostfach: async (xml, ...rest): Promise<PostfachResult> => {
        const base = await fake.send(xml, rest[0], rest[1], { test: rest[2].test, print: false });
        return {
          ...base,
          bereitstellungen: [
            {
              id: "B1",
              datenart: "DivaBescheidESt",
              groesse: 10,
              veranlagungszeitraum: "2024",
              steuernummer: "9198011310010",
              bescheiddatum: "2025-06-30",
              anhaenge: [{ dateibezeichnung: "Bescheid ESt", dateityp: "application/pdf", referenzId: "R1", groesse: 5 }],
            },
            {
              id: "B2",
              datenart: "EPMitteilung",
              groesse: 10,
              veranlagungszeitraum: "",
              steuernummer: "",
              bescheiddatum: "",
              anhaenge: [
                { dateibezeichnung: "Mitteilung", dateityp: "application/pdf", referenzId: "R2", groesse: 5 },
                { dateibezeichnung: "Anlage", dateityp: "application/pdf", referenzId: "R3", groesse: 5 },
              ],
            },
          ],
          dateien: [
            { referenzId: "R1", inhalt: pdf("Bescheid") },
            { referenzId: "R2", inhalt: pdf("Mitteilung") },
            { referenzId: "R3", fehler: "Otto-Fehler 610" },
          ],
        };
      },
    };
    return { client, sent };
  }

  it("speichert die Anhänge und bestätigt nur vollständig abgeholte Bereitstellungen", async () => {
    const { client, sent } = scriptedClient();
    const summary = await postfach.fetchPostfach(actor, client, { kind: "test", pin: "1234" });
    expect(summary).toMatchObject({ ok: true, neu: 2, bestaetigt: 1, bestaetigungFehler: null, fehler: [{ referenzId: "R3", fehler: "Otto-Fehler 610" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`<Bereitstellung id="B1"/>`);
    expect(sent[0]).not.toContain(`id="B2"`);

    const docs = await postfach.listPostfachDocuments();
    expect(docs.map((d) => [d.filename, d.mimeType, d.test])).toEqual(
      expect.arrayContaining([
        ["Bescheid_ESt_2024.pdf", "application/pdf", true],
        ["Mitteilung.pdf", "application/pdf", true],
      ]),
    );
    const bescheid = docs.find((d) => d.datenart === "DivaBescheidESt")!;
    const file = await postfach.postfachDocumentFile(bescheid.id);
    expect(Buffer.from(await storage.loadFile(file!.sha256)).toString()).toBe("%PDF-1.4 Bescheid");
    expect(await postfach.pendingConfirmations(true)).toEqual([]);
    await expect(sql`delete from postfach_documents`).rejects.toThrow();
    await expect(sql`update postfach_requests set ok = false`).rejects.toThrow();
  });

  it("legt nichts doppelt ab und holt eine gescheiterte Bestätigung beim nächsten Abruf nach", async () => {
    const failing = scriptedClient({ confirmOk: false });
    const first = await postfach.fetchPostfach(actor, failing.client, { kind: "test", pin: "1234" });
    expect(first).toMatchObject({ neu: 2, bestaetigt: 0, bestaetigungFehler: "Server nicht erreichbar" });
    expect(await postfach.pendingConfirmations(true)).toEqual(["B1"]);
    expect(await postfach.pendingConfirmations(false)).toEqual([]);

    const second = await postfach.fetchPostfach(actor, scriptedClient().client, { kind: "test", pin: "1234" });
    expect(second).toMatchObject({ neu: 0, bestaetigt: 1 });
    expect(await postfach.pendingConfirmations(true)).toEqual([]);
    expect((await postfach.lastPostfachRequest())?.test).toBe(true);
  });

  it("ruft ohne ERiC nicht echt ab und braucht ein Zertifikat", async () => {
    const fake = new elster.FakeElsterClient();
    await expect(postfach.fetchPostfach(actor, fake, { kind: "send", pin: "1234", herstellerId: "12345" })).rejects.toThrow(/Ohne ERiC/);
    await expect(postfach.fetchPostfach(actor, fake, { kind: "send", pin: "1234" })).rejects.toThrow(/Hersteller-ID/);
    await sql`truncate elster_certificates`;
    await expect(postfach.fetchPostfach(actor, fake, { kind: "test", pin: "1234" })).rejects.toThrow(/Zertifikat/);
  });

  it("holt mit dem simulierten Client einen Testbescheid", async () => {
    const summary = await postfach.fetchPostfach(actor, new elster.FakeElsterClient(), { kind: "test", pin: "1234" });
    expect(summary).toMatchObject({ ok: true, neu: 1, bestaetigt: 1 });
  });
});
