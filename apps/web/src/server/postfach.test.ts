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

  it("schaltet den automatischen Abruf nur nach erfolgreichem Echtabruf ein und hält die PIN aus dem Audit-Log", async () => {
    const { client } = scriptedClient();
    await expect(postfach.enableAutoFetch(actor, new elster.FakeElsterClient(), "1234", "12345")).rejects.toThrow(/Ohne ERiC/);
    expect((await postfach.autoFetchStatus()).enabled).toBe(false);

    const summary = await postfach.enableAutoFetch(actor, client, "geheim", "12345");
    expect(summary).toMatchObject({ ok: true, neu: 2 });
    const status = await postfach.autoFetchStatus();
    expect(status.enabled).toBe(true);
    expect(status.lastLive?.ok).toBe(true);
    const [cert] = await sql`select pin_ciphertext from elster_certificates`;
    expect(Buffer.from(cert!.pin_ciphertext).toString()).not.toContain("geheim");
    const audit = await sql`select new_value from audit_log where table_name = 'elster_certificates' order by id desc limit 1`;
    expect(audit[0]!.new_value).not.toHaveProperty("pin_ciphertext");
    expect(audit[0]!.new_value.pin_saved_at).toBeTruthy();

    // Innerhalb von 20 Stunden kein weiterer Abruf, danach mit gespeicherter PIN
    expect(await postfach.runDuePostfachFetch(client, "12345")).toBeNull();
    const later = new Date(Date.now() + 21 * 60 * 60 * 1000);
    const pins: string[] = [];
    const spy = { ...client, fetchPostfach: (xml: string, cert: Uint8Array, pin: string, opts: Parameters<typeof client.fetchPostfach>[3]) => (pins.push(pin), client.fetchPostfach(xml, cert, pin, opts)) };
    expect(await postfach.runDuePostfachFetch(spy, "12345", later)).toMatchObject({ ok: true });
    expect(pins).toEqual(["geheim"]);
    expect(await postfach.runDuePostfachFetch(spy, undefined, later)).toBeNull();

    await postfach.disableAutoFetch(actor);
    expect((await postfach.autoFetchStatus()).enabled).toBe(false);
    expect(await postfach.runDuePostfachFetch(spy, "12345", new Date(Date.now() + 48 * 60 * 60 * 1000))).toBeNull();
  });

  it("zeigt Einspruchsfristen nur für Bescheide und nur aus Echtabrufen", async () => {
    await postfach.fetchPostfach(actor, scriptedClient().client, { kind: "test", pin: "1234" });
    let docs = await postfach.listPostfachDocuments();
    const bescheid = docs.find((d) => d.datenart === "DivaBescheidESt")!;
    // 30.6.2025 + 4 Tage = 4.7. (Freitag), Frist 4.8.2025 (Montag)
    expect(bescheid.frist).toEqual({ bekanntgabe: "2025-07-04", fristende: "2025-08-04" });
    expect(docs.find((d) => d.datenart === "EPMitteilung")!.frist).toBeNull();
    expect(await postfach.openAppealDeadlines("2025-07-10")).toEqual([]);

    await sql`truncate postfach_documents, postfach_requests cascade`;
    await postfach.fetchPostfach(actor, scriptedClient().client, { kind: "send", pin: "1234", herstellerId: "12345" });
    docs = await postfach.listPostfachDocuments();
    expect(docs.every((d) => !d.test)).toBe(true);
    expect((await postfach.openAppealDeadlines("2025-07-10")).map((d) => d.frist!.fristende)).toEqual(["2025-08-04"]);
    expect(await postfach.openAppealDeadlines("2025-08-05")).toEqual([]);
  });
});
