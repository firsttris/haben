import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

type Mail = Parameters<ReturnType<typeof nodemailer.createTransport>["sendMail"]>[0];

describe.skipIf(!testDatabaseUrl)("Belege per E-Mail (Postgres)", () => {
  let inbox: typeof import("./inbox.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  /** Postfach im Speicher: UID → Quelltext, gelesen ja/nein */
  let box: Map<number, { source: Buffer; seen: boolean }>;
  let failConnect = false;
  let lastPassword = "";

  const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const build = async (mail: Mail) =>
    (await composer.sendMail({ from: "Funknetz <rechnung@funknetz.example>", to: "belege@mustermann.example", ...mail })).message as Buffer;
  const deliver = async (...mails: Mail[]) => {
    for (const mail of mails) box.set(box.size + 1, { source: await build(mail), seen: false });
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    inbox = await import("./inbox.ts");
    inbox.setInboxConnectorForTests(async (_settings, password) => {
      lastPassword = password;
      if (failConnect) throw new Error("AUTHENTICATIONFAILED");
      return {
        unseen: async () => [...box].filter(([, m]) => !m.seen).map(([uid]) => uid),
        source: async (uid) => box.get(uid)!.source,
        markSeen: async (uid) => void (box.get(uid)!.seen = true),
        close: async () => {},
      };
    });
  }, 30_000);

  afterAll(async () => {
    inbox.setInboxConnectorForTests(null);
    await sql?.end();
  });

  beforeEach(async () => {
    box = new Map();
    failConnect = false;
    await sql`truncate inbox_messages, inbox_settings, document_amounts, documents cascade`;
  });

  const settings = { host: "imap.example.com", port: 993, secure: true, username: "belege@mustermann.example", password: "geheim", folder: "Belege" };

  it("legt Anhänge als Belege ab, überspringt Signaturbilder und Fremdes, markiert gelesen", async () => {
    await expect(inbox.fetchInbox(actor)).rejects.toThrow(/kein Postfach/);
    await expect(inbox.saveInboxSettings(actor, { ...settings, password: "" })).rejects.toThrow(/Passwort fehlt/);
    await inbox.saveInboxSettings(actor, settings);

    await deliver(
      {
        subject: "Ihre Rechnung MF-0815",
        messageId: "<mf-0815@funknetz.example>",
        html: '<p>Anbei</p><img src="cid:logo">',
        attachments: [
          { filename: "Rechnung-MF-0815.pdf", content: pdf("MF-0815") },
          { filename: "logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]), cid: "logo", contentDisposition: "inline" },
          { filename: "AGB.docx", content: Buffer.from("PK\u0003\u0004 kein Beleg") },
        ],
      },
      { subject: "Newsletter", messageId: "<news@funknetz.example>", text: "Ohne Anhang" },
      // Dieselbe Rechnung noch einmal weitergeleitet
      { subject: "Fwd: Ihre Rechnung MF-0815", messageId: "<fwd@mustermann.example>", attachments: [{ filename: "Rechnung.pdf", content: pdf("MF-0815") }] },
    );

    const result = await inbox.fetchInbox(actor);
    expect(result).toEqual({ messages: 3, documents: 1, duplicates: 1, skipped: 2 });
    expect(lastPassword).toBe("geheim");
    expect([...box.values()].every((m) => m.seen)).toBe(true);

    const docs = await sql`select filename, note from documents`;
    expect(docs.map((d) => ({ ...d }))).toEqual([
      { filename: "Rechnung-MF-0815.pdf", note: "Per E-Mail von Funknetz <rechnung@funknetz.example>, Betreff „Ihre Rechnung MF-0815“" },
    ]);
    const log = await sql`select message_id, cardinality(document_ids) as docs, duplicates, skipped from inbox_messages order by created_at, message_id`;
    expect(log.map((r) => [r.message_id, r.docs, r.duplicates, r.skipped])).toEqual(
      expect.arrayContaining([
        ["<mf-0815@funknetz.example>", 1, 0, ["AGB.docx: Erlaubt sind PDF, JPEG, PNG, WebP, HEIC und E-Rechnungs-XML."]],
        ["<news@funknetz.example>", 0, 0, ["keine Anhänge"]],
        ["<fwd@mustermann.example>", 0, 1, []],
      ]),
    );

    // Wieder ungelesen markiert: schon verarbeitet, kein zweiter Eintrag
    box.get(1)!.seen = false;
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 0, documents: 0, duplicates: 0, skipped: 0 });
    expect(box.get(1)!.seen).toBe(true);
    expect(await sql`select 1 from inbox_messages`).toHaveLength(3);
    const summary = await inbox.inboxSummary();
    expect(summary.settings).toMatchObject({ folder: "Belege", lastError: null });
    expect(summary.settings).not.toHaveProperty("ciphertext");
  });

  it("merkt sich Fehler beim Verbinden und hält das Passwort aus dem Protokoll", async () => {
    const max = Number((await sql`select coalesce(max(id), 0) as max from audit_log`)[0]!.max);
    await inbox.saveInboxSettings(actor, settings);
    failConnect = true;
    await expect(inbox.fetchInbox(actor)).rejects.toThrow(/AUTHENTICATIONFAILED/);
    expect((await inbox.inboxSummary()).settings?.lastError).toBe("AUTHENTICATIONFAILED");
    // Der Abruf schreibt nichts ins Protokoll, nur das Anlegen
    const audit = await sql`select action, new_value from audit_log where table_name = 'inbox_settings' and id > ${max} order by id`;
    expect(audit.map((r) => r.action)).toEqual(["INSERT"]);
    expect(audit[0]!.new_value).not.toHaveProperty("ciphertext");
    await sql`update inbox_settings set enabled = false`;
    expect(await inbox.runDueInboxFetch()).toBeNull();
  });
});
