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
  /** Ordner „Ausgang“ */
  let ausgangBox: Box;
  let failConnect = false;
  let lastPassword = "";

  const boxEingang = () => box;
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
      if (failConnect) throw new Error("AUTHENTICATIONFAILED");
      const box = folder === "Ausgang" ? ausgangBox : boxEingang();
      return {
        envelope: async (uid) => {
          const mail = await simpleParser(box.get(uid)!.source);
          return { address: mail.from?.value[0]?.address ?? "", messageId: mail.messageId ?? "", subject: mail.subject ?? "", date: mail.date ?? null };
        },
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
    ausgangBox = new Map();
    failConnect = false;
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

  it("holt nur Mails freigegebener Absender, lässt die übrigen ungelesen und protokolliert sie einmal", async () => {
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
    const rejected = await sql`select message_id, sender, skipped from inbox_messages where skipped[1] like 'Absender nicht freigegeben%' order by message_id`;
    expect(rejected.map((r) => [r.message_id, r.skipped[0]])).toEqual([
      ["<c@fremd.example>", "Absender nicht freigegeben: chef@fremd.example"],
      ["<d@funknetz.example>", "Absender nicht freigegeben: andere@funknetz.example"],
      ["<e@lieferant.example>", "Absender nicht freigegeben: x@sub.lieferant.example"],
    ]);

    // Zweiter Abruf: wieder abgelehnt, aber nicht noch einmal protokolliert
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 0, documents: 0, duplicates: 0, skipped: 0, rejected: 3 });
    expect(await sql`select 1 from inbox_messages`).toHaveLength(5);

    // Absender nachträglich freigegeben: die ungelesene Mail wird nachgeholt
    await inbox.saveInboxSettings(actor, { ...settings, allowedSenders: ["fremd.example"] });
    expect(await inbox.fetchInbox(actor)).toEqual({ messages: 1, documents: 1, duplicates: 0, skipped: 0, rejected: 2 });
    expect(box.get(3)!.seen).toBe(true);
    expect(await sql`select 1 from inbox_messages where message_id like '<c@fremd.example>%'`).toHaveLength(2);
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

  it("liest den Ausgangsordner nur mit Übernahme, getrennt vom Eingang und ohne Eingangsbeleg", async () => {
    await inbox.saveInboxSettings(actor, { ...settings, outboundFolder: "Ausgang" });
    expect((await inbox.inboxSummary()).settings).toMatchObject({ outboundFolder: "Ausgang" });
    ausgangBox.set(1, {
      source: await build({
        from: "Shop <shop@mustermann.example>",
        subject: "RE-1",
        messageId: "<re-1@mustermann.example>",
        attachments: [{ filename: "RE-1.pdf", content: pdf("RE-1") }],
      }),
      seen: false,
    });

    // Ohne Übernahme (heute): Ordner unberührt
    expect(await inbox.fetchInbox(actor)).toMatchObject({ messages: 0 });
    expect(ausgangBox.get(1)!.seen).toBe(false);

    const taken: string[] = [];
    inbox.setOutboundHandler(async (_actor, file) => {
      taken.push(file.filename);
      return { id: "rechnung-1", duplicate: false };
    });
    try {
      // Dieselbe Mail liegt auch im Eingang: zwei getrennte Einträge
      box.set(1, { source: ausgangBox.get(1)!.source, seen: false });
      expect(await inbox.fetchInbox(actor)).toEqual({ messages: 2, documents: 2, duplicates: 0, skipped: 0, rejected: 0 });
    } finally {
      inbox.setOutboundHandler(null);
    }
    expect(taken).toEqual(["RE-1.pdf"]);
    expect(ausgangBox.get(1)!.seen).toBe(true);
    // Der Anhang aus dem Ausgang ist kein Eingangsbeleg
    expect((await sql`select filename from documents`).map((d) => d.filename)).toEqual(["RE-1.pdf"]);
    const log = await sql`select direction, cardinality(document_ids) as docs from inbox_messages order by direction`;
    expect(log.map((r) => [r.direction, r.docs])).toEqual([
      ["ausgang", 0],
      ["eingang", 1],
    ]);
  });
});
