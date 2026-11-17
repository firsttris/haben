import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

type Mail = Parameters<ReturnType<typeof nodemailer.createTransport>["sendMail"]>[0];

describe.skipIf(!testDatabaseUrl)("Belege per E-Mail (Postgres)", () => {
  let inbox: typeof import("./inbox.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  /** Postfach im Speicher: UID → Quelltext, gelesen ja/nein */
  type Box = Map<number, { source: Buffer; seen: boolean; tooLarge?: boolean }>;
  let box: Box;
  let failConnect = false;
  let lastPassword = "";
  /** Ordner, für die ein Abruf eine Verbindung geöffnet hat */
  let folders: string[] = [];

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
    inbox.setInboxConnectorForTests(async (_settings, password, folder) => {
      lastPassword = password;
      folders.push(folder);
      if (failConnect) throw new Error("AUTHENTICATIONFAILED");
      return {
        sender: async (uid) => (await simpleParser(box.get(uid)!.source)).from?.value[0]?.address ?? "",
        unseen: async () => [...box].filter(([, m]) => !m.seen).map(([uid]) => uid),
        source: async (uid) => {
          const { source, tooLarge = false } = box.get(uid)!;
          // Zu groß: der echte Abruf liefert dann nur die Kopfzeilen
          return { bytes: tooLarge ? source.subarray(0, source.indexOf("\r\n\r\n") + 4) : source, tooLarge };
        },
        markSeen: async (uid) => {
          box.get(uid)!.seen = true;
        },
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
    folders = [];
    await leeren(sql)`truncate inbox_messages, inbox_settings, document_amounts, documents cascade`;
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
    expect(result).toEqual({ messages: 3, documents: 1, duplicates: 1, skipped: 2, rejected: 0 });
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
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 0 });
    expect(box.get(1)!.seen).toBe(true);
    expect(await sql`select 1 from inbox_messages`).toHaveLength(3);
    const summary = await inbox.inboxSummary();
    expect(summary.settings).toMatchObject({ folder: "Belege", lastError: null });
    expect(summary.settings).not.toHaveProperty("ciphertext");
  });

  it("lädt zu große Mails nicht, vermerkt sie und markiert sie gelesen", async () => {
    await inbox.saveInboxSettings(actor, settings);
    await deliver({ subject: "Riesig", messageId: "<riesig@funknetz.example>", attachments: [{ filename: "Rechnung.pdf", content: pdf("gross") }] });
    box.get(1)!.tooLarge = true;
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 0, duplicates: 0, skipped: 1, rejected: 0 });
    expect(box.get(1)!.seen).toBe(true);
    const [log] = await sql`select subject, skipped from inbox_messages where message_id = '<riesig@funknetz.example>'`;
    expect(log).toEqual({ subject: "Riesig", skipped: ["Mail größer als 60 MB, Anhänge bitte einzeln hochladen"] });
    expect(await sql`select 1 from documents`).toHaveLength(0);
  });

  it("entfernt Steuerzeichen aus Absender, Betreff und Dateinamen", async () => {
    await inbox.saveInboxSettings(actor, settings);
    // Postgres-Text kann kein NUL speichern; vorher brach daran jeder Abruf ab
    await deliver({
      from: "Fun\u0000knetz <rechnung@funknetz.example>",
      subject: "Rechnung\u0000 MF-1\u0007",
      messageId: "<nul@funknetz.example>",
      attachments: [{ filename: "Rech\u0000nung.pdf", content: pdf("MF-1") }],
    });
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 1, duplicates: 0, skipped: 0, rejected: 0 });
    const [doc] = await sql`select filename, note from documents`;
    expect(doc).toEqual({ filename: "Rechnung.pdf", note: "Per E-Mail von Funknetz <rechnung@funknetz.example>, Betreff „Rechnung MF-1“" });
  });

  it("überspringt eine Mail, an der die Verarbeitung scheitert, statt den Eingang zu blockieren", async () => {
    await inbox.saveInboxSettings(actor, settings);
    await deliver(
      { subject: "Kaputt", messageId: "<kaputt@funknetz.example>", attachments: [{ filename: "kaputt.pdf", content: pdf("kaputt") }] },
      { subject: "Gut", messageId: "<gut@funknetz.example>", attachments: [{ filename: "gut.pdf", content: pdf("gut") }] },
    );
    await sql`alter table documents add constraint test_kaputt check (filename <> 'kaputt.pdf')`;
    try {
      expect(await inbox.fetchInbox(actor)).toEqual({ messages: 2, documents: 1, duplicates: 0, skipped: 1, rejected: 0 });
    } finally {
      await sql`alter table documents drop constraint test_kaputt`;
    }
    expect([...box.values()].every((m) => m.seen)).toBe(true);
    expect((await sql`select filename from documents`).map((d) => d.filename)).toEqual(["gut.pdf"]);
    const [log] = await sql`select subject, skipped from inbox_messages where message_id = '<kaputt@funknetz.example>'`;
    expect(log!.subject).toBe("Kaputt");
    expect(log!.skipped).toEqual([expect.stringMatching(/^Verarbeitung fehlgeschlagen: .*test_kaputt/)]);
    expect((await inbox.inboxSummary()).settings?.lastError).toBeNull();
  });

  it("holt eine fehlgeschlagene Mail nach, wenn sie im Postfach wieder als ungelesen markiert ist", async () => {
    await inbox.saveInboxSettings(actor, settings);
    await deliver({ subject: "Kaputt", messageId: "<nochmal@funknetz.example>", attachments: [{ filename: "kaputt.pdf", content: pdf("nochmal") }] });
    await sql`alter table documents add constraint test_kaputt check (filename <> 'kaputt.pdf')`;
    try {
      expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 0, duplicates: 0, skipped: 1, rejected: 0 });
    } finally {
      await sql`alter table documents drop constraint test_kaputt`;
    }
    // Ursache behoben (z. B. Speicher wieder da), Mail im Postfach wieder auf ungelesen gesetzt
    box.get(1)!.seen = false;
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 1, duplicates: 0, skipped: 0, rejected: 0 });
    expect((await sql`select filename from documents`).map((d) => d.filename)).toEqual(["kaputt.pdf"]);
    // inbox_messages ist nur zu ergänzen: der Fehlschlag bleibt protokolliert, das Nachholen kommt dazu
    const logs =
      await sql`select cardinality(document_ids) as documents, skipped from inbox_messages where message_id like '<nochmal@funknetz.example>%' order by created_at`;
    expect(logs).toEqual([
      { documents: 0, skipped: [expect.stringMatching(/^Verarbeitung fehlgeschlagen: /)] },
      { documents: 1, skipped: [] },
    ]);
    // Danach gilt sie als abgerufen
    box.get(1)!.seen = false;
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 0 });
  });

  it("protokolliert jeden weiteren Fehlschlag und holt die Mail auch nach vielen Versuchen noch ab", async () => {
    await inbox.saveInboxSettings(actor, settings);
    await deliver({ subject: "Kaputt", messageId: "<oft@funknetz.example>", attachments: [{ filename: "kaputt.pdf", content: pdf("oft") }] });
    await sql`alter table documents add constraint test_kaputt check (filename <> 'kaputt.pdf')`;
    try {
      for (let attempt = 1; attempt <= 7; attempt++) {
        box.get(1)!.seen = false;
        expect(await inbox.fetchInbox(actor), `Versuch ${attempt}`).toEqual({ messages: 1, documents: 0, duplicates: 0, skipped: 1, rejected: 0 });
      }
    } finally {
      await sql`alter table documents drop constraint test_kaputt`;
    }
    box.get(1)!.seen = false;
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 1, duplicates: 0, skipped: 0, rejected: 0 });
    // Jeder Versuch unter eigenem Schlüssel, keiner von onConflictDoNothing verschluckt
    const logs = (await sql`select message_id, cardinality(document_ids) as documents from inbox_messages`).sort((a, b) =>
      a.message_id < b.message_id ? -1 : 1,
    );
    expect(logs).toEqual([
      { message_id: "<oft@funknetz.example>", documents: 0 },
      { message_id: "<oft@funknetz.example> (nachgeholt 2)", documents: 0 },
      { message_id: "<oft@funknetz.example> (nachgeholt 3)", documents: 0 },
      { message_id: "<oft@funknetz.example> (nachgeholt 4)", documents: 0 },
      { message_id: "<oft@funknetz.example> (nachgeholt 5)", documents: 0 },
      { message_id: "<oft@funknetz.example> (nachgeholt 6)", documents: 0 },
      { message_id: "<oft@funknetz.example> (nachgeholt 7)", documents: 1 },
      { message_id: "<oft@funknetz.example> (nachgeholt)", documents: 0 },
    ]);
    box.get(1)!.seen = false;
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 0 });
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

  it("holt nur Mails freigegebener Absender, lässt die übrigen ungelesen und zählt sie nur", async () => {
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["Rechnung@Funknetz.example", "@Lieferant.example"] });
    await deliver(
      { subject: "Funknetz", messageId: "<a@funknetz.example>", attachments: [{ filename: "a.pdf", content: pdf("a") }] },
      {
        from: "Buchhaltung <buchhaltung@lieferant.example>",
        subject: "Lieferant",
        messageId: "<b@lieferant.example>",
        attachments: [{ filename: "b.pdf", content: pdf("b") }],
      },
      { from: "Spam <chef@fremd.example>", subject: "Gewinn", messageId: "<c@fremd.example>", attachments: [{ filename: "c.pdf", content: pdf("c") }] },
      // Nur die Domain eines Eintrags mit Adresse reicht nicht, Unterdomains auch nicht
      {
        from: "Funknetz <andere@funknetz.example>",
        subject: "Andere Adresse",
        messageId: "<d@funknetz.example>",
        attachments: [{ filename: "d.pdf", content: pdf("d") }],
      },
      { from: "x@sub.lieferant.example", subject: "Unterdomain", messageId: "<e@lieferant.example>", attachments: [{ filename: "e.pdf", content: pdf("e") }] },
    );
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 2, documents: 2, duplicates: 0, skipped: 0, rejected: 3 });
    expect([...box.values()].map((m) => m.seen)).toEqual([true, true, false, false, false]);
    expect((await sql`select filename from documents order by filename`).map((d) => d.filename)).toEqual(["a.pdf", "b.pdf"]);
    // Von abgelehnten Mails bleibt nichts im Protokoll, weder Absender noch Betreff; nur die Zahl steht bei den Einstellungen
    expect((await sql`select message_id from inbox_messages order by message_id`).map((r) => r.message_id)).toEqual([
      "<a@funknetz.example>",
      "<b@lieferant.example>",
    ]);
    expect((await inbox.inboxSummary()).settings).toMatchObject({ lastRejected: 3 });
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 3 });
    expect(await sql`select 1 from inbox_messages`).toHaveLength(2);

    // Absender nachträglich freigegeben: die ungelesene Mail wird nachgeholt
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["fremd.example"] });
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 1, duplicates: 0, skipped: 0, rejected: 2 });
    expect(box.get(3)!.seen).toBe(true);
    expect(await sql`select 1 from inbox_messages where message_id = '<c@fremd.example>'`).toHaveLength(1);
    expect((await inbox.inboxSummary()).settings).toMatchObject({ lastRejected: 2 });
  });

  it("zählt Mails nicht freigegebener Absender nicht gegen die Obergrenze je Abruf", async () => {
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["funknetz.example"] });
    const fremd = Array.from({ length: 60 }, (_, i) => ({ from: "x@fremd.example", subject: `Fremd ${i}`, messageId: `<f${i}@fremd.example>`, text: "Hallo" }));
    await deliver(...fremd, { subject: "Echt", messageId: "<echt@funknetz.example>", attachments: [{ filename: "echt.pdf", content: pdf("echt") }] });
    const result = await inbox.fetchInbox(actor);
    expect(result).toMatchObject({ messages: 1, documents: 1, rejected: 60 });
  });

  it("lässt eine leere Absenderliste jeden Absender zu und prüft die Einträge", async () => {
    await expect(inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["zwei wörter"] })).rejects.toThrow(/ohne Leerzeichen/);
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: [" A@B.example ", "a@b.example", ""] });
    expect((await inbox.inboxSummary()).settings?.allowedSenders).toEqual(["a@b.example"]);
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: [] });
    await deliver({
      from: "irgendwer@fremd.example",
      subject: "Egal",
      messageId: "<egal@fremd.example>",
      attachments: [{ filename: "egal.pdf", content: pdf("egal") }],
    });
    expect(await inbox.fetchInbox(actor)).toMatchObject({ messages: 1, documents: 1, rejected: 0 });
  });

  it("weist denselben Ordner für Eingang und Ausgang ab, auch in anderer Schreibweise", async () => {
    await expect(inbox.saveInboxSettings(actor, { ...settings, outboundFolder: "Belege" })).rejects.toThrow(/verschieden/);
    await expect(inbox.saveInboxSettings(actor, { ...settings, folder: "INBOX", outboundFolder: "inbox" })).rejects.toThrow(/verschieden/);
    await inbox.saveInboxSettings(actor, { ...settings, outboundFolder: "Ausgang" });
  });

  it("liest nur den Ordner für Eingangsrechnungen, der Ausgangsordner bleibt ohne Wirkung", async () => {
    await inbox.saveInboxSettings(actor, { ...settings, outboundFolder: "Ausgang" });
    expect((await inbox.inboxSummary()).settings).toMatchObject({ outboundFolder: "Ausgang" });
    await deliver({ subject: "RE-1", messageId: "<re-1@funknetz.example>", attachments: [{ filename: "RE-1.pdf", content: pdf("RE-1") }] });
    await inbox.fetchInbox(actor);
    expect(folders).toEqual(["Belege"]);
  });

  it("holt eine nach nachträglicher Freigabe gescheiterte Mail beim nächsten Versuch unter eigenem Schlüssel nach", async () => {
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["lieferant.example"] });
    await deliver({
      from: "x@fremd.example",
      subject: "Fremd",
      messageId: "<fremd@fremd.example>",
      attachments: [{ filename: "kaputt.pdf", content: pdf("kaputt") }],
    });
    expect(await inbox.fetchInbox(actor)).toMatchObject({ messages: 0, rejected: 1 });
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["fremd.example"] });
    await sql`alter table documents add constraint test_kaputt check (filename <> 'kaputt.pdf')`;
    try {
      expect(await inbox.fetchInbox(actor)).toMatchObject({ messages: 1, documents: 0, skipped: 1, rejected: 0 });
    } finally {
      await sql`alter table documents drop constraint test_kaputt`;
    }
    const logs = await sql`select message_id, skipped from inbox_messages where message_id like '<fremd@fremd.example>%' order by created_at`;
    expect(logs.map((r) => [r.message_id, r.skipped[0].split(":")[0]])).toEqual([["<fremd@fremd.example>", "Verarbeitung fehlgeschlagen"]]);
    // Ursache behoben, wieder ungelesen: der zweite Versuch kommt unter einem eigenen Schlüssel ins Protokoll
    box.get(1)!.seen = false;
    expect(await inbox.fetchInbox(actor)).toMatchObject({ messages: 1, documents: 1 });
    expect(await sql`select 1 from inbox_messages where message_id like '<fremd@fremd.example>%'`).toHaveLength(2);
  });

  it("protokolliert eine Änderung nur der Absenderfreigabe oder des Ausgangsordners", async () => {
    await inbox.saveInboxSettings(actor, settings);
    const max = Number((await sql`select coalesce(max(id), 0) as max from audit_log`)[0]!.max);
    await sql`update inbox_settings set allowed_senders = '{a.example}'`;
    await sql`update inbox_settings set outbound_folder = 'Ausgang'`;
    const audit = await sql`select action, new_value from audit_log where table_name = 'inbox_settings' and id > ${max} order by id`;
    expect(audit.map((r) => r.action)).toEqual(["UPDATE", "UPDATE"]);
    expect(audit[0]!.new_value).toMatchObject({ allowed_senders: ["a.example"] });
    expect(audit[1]!.new_value).toMatchObject({ outbound_folder: "Ausgang" });
    expect(audit[1]!.new_value).not.toHaveProperty("ciphertext");
  });
});
