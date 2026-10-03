import type postgres from "postgres";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Fristen, Kalender-Abo und Erinnerungen per E-Mail (Postgres)", () => {
  let fristen: typeof import("./fristen.ts");
  let mail: typeof import("./mail.ts");
  let taxpayer: typeof import("./taxpayer.ts");
  let crypto: typeof import("./crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const sent: { to: string; subject: string; text: string }[] = [];
  let failNext = false;

  beforeAll(async () => {
    sql = await setupTestDb();
    fristen = await import("./fristen.ts");
    mail = await import("./mail.ts");
    taxpayer = await import("./taxpayer.ts");
    crypto = await import("./crypto.ts");
    mail.setMailTransportForTests(() => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      return {
        sendMail: async (message: { to: string; subject: string; text: string }) => {
          if (failNext) {
            failNext = false;
            throw new Error("Authentifizierung fehlgeschlagen");
          }
          sent.push({ to: message.to, subject: message.subject, text: message.text });
          return transport.sendMail(message);
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>;
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    await sql`truncate journal_lines, journal_entries, vat_return_submissions, vat_returns, annual_submissions, elster_certificates, mail_log, mail_settings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland) values (1, 'Testfirma', 'Musterstraße 1', '77815', 'Bühl', '35/123/45678', 'BW')`;
    await taxpayer.saveTaxpayer(actor, {
      a: { idnr: "65929970489", anrede: "Herrn", vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "" },
    });
    // Erste Buchung im Juli 2026
    await sql`insert into journal_entries (date, description, source_type, source_id, kontenrahmen) values ('2026-07-15', 'Test', 'invoice', gen_random_uuid(), 'SKR03')`;
  });

  it("sammelt Voranmeldungen, Erklärungen, Vorauszahlungen und das Zertifikat", async () => {
    await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 7, 'sent', 0, 0, 0, 0, now())`;
    await sql`insert into elster_certificates (filename, ciphertext, valid_until) values ('max.pfx', ${crypto.encrypt(new Uint8Array([1]))}, '2027-01-15')`;
    const list = await fristen.listFristen("2026-10-03");
    const byId = new Map(list.map((f) => [f.id, f]));
    expect(byId.get("ustva-2026-07")).toMatchObject({ status: "erledigt", datum: "2026-08-10" });
    expect(byId.get("ustva-2026-08")).toMatchObject({ status: "offen", datum: "2026-09-10", link: "/umsatzsteuer/2026-08" });
    expect(byId.get("ustva-2026-09")).toMatchObject({ status: "offen", datum: "2026-10-12" }); // 10.10.2026 ist ein Samstag
    expect(byId.has("ustva-2026-06")).toBe(false); // vor der ersten Buchung
    expect(byId.get("est-2026")).toMatchObject({ datum: "2027-08-02", art: "erklaerung", status: "offen" });
    expect(byId.get("vz-2026-q4")).toMatchObject({ datum: "2026-12-10", status: "hinweis" });
    expect(byId.has("vz-2026-q3")).toBe(false); // vorbei
    expect(byId.get("zertifikat-" + list.find((f) => f.art === "zertifikat")!.id.slice(11))).toMatchObject({ datum: "2027-01-15" });
    expect(list.map((f) => f.datum)).toEqual([...list.map((f) => f.datum)].sort());

    await sql`update company set kleinunternehmer = true`;
    const ku = await fristen.listFristen("2026-10-03");
    expect(ku.some((f) => f.art === "ustva" || f.id.startsWith("ust-"))).toBe(false);
  });

  it("liefert offene Fristen als Kalender-Abo nur mit gültigem Token", async () => {
    expect(await fristen.calendarTokenActive()).toBe(false);
    const token = await fristen.createCalendarToken(actor);
    expect(await fristen.checkCalendarToken(token)).toBe(true);
    expect(await fristen.checkCalendarToken("falsch")).toBe(false);
    const [row] = await sql`select calendar_token_hash from company`;
    expect(row!.calendar_token_hash).not.toContain(token);

    const second = await fristen.createCalendarToken(actor);
    expect(await fristen.checkCalendarToken(token)).toBe(false);
    expect(await fristen.checkCalendarToken(second)).toBe(true);
    await fristen.revokeCalendarToken(actor);
    expect(await fristen.checkCalendarToken(second)).toBe(false);

    const ics = fristen.fristenToIcs(await fristen.listFristen("2026-10-03"), "https://haben.example", new Date("2026-10-03T10:00:00Z"));
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("UID:ustva-2026-09@haben\r\nDTSTAMP:20261003T100000Z\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013");
    expect(ics).toContain("URL:https://haben.example/umsatzsteuer/2026-09");
    expect(ics).toContain("TRIGGER:-P3D");
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });

  it("erinnert per E-Mail je Frist und Stufe nur einmal, morgens und mit Protokoll", async () => {
    await mail.saveMailSettings(actor, {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "max",
      password: "geheim",
      fromAddress: "haben@example.com",
      reminderTo: "max@example.com",
      remindersEnabled: true,
      reminderDays: [7, 1],
    });
    const [settings] = await sql`select ciphertext from mail_settings`;
    expect(Buffer.from(settings!.ciphertext).toString()).not.toContain("geheim");
    const audit = await sql`select new_value from audit_log where table_name = 'mail_settings'`;
    expect(audit[0]!.new_value).not.toHaveProperty("ciphertext");

    const morgens = new Date("2026-10-05T06:00:00Z"); // 8 Uhr in Berlin
    // Nachts nichts
    expect(await mail.runDueFristenMails("2026-10-05", new Date("2026-10-05T02:00:00Z"))).toBeNull();

    // 5.10.: Juli (10.8.) und August (10.9.) überfällig, September in 7 Tagen (12.10.)
    expect(await mail.runDueFristenMails("2026-10-05", morgens)).toEqual({ sent: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("max@example.com");
    expect(sent[0]!.subject).toBe("3 Steuerfristen stehen an");
    expect(sent[0]!.text).toContain("10.09.2026 (seit 25 Tagen überfällig): Umsatzsteuer-Voranmeldung August 2026");
    expect(sent[0]!.text).toContain("12.10.2026 (in 7 Tagen): Umsatzsteuer-Voranmeldung September 2026");

    // Am selben und am nächsten Tag nichts Neues; einen Tag vorher die nächste Stufe
    expect(await mail.runDueFristenMails("2026-10-05", morgens)).toEqual({ sent: 0 });
    expect(await mail.runDueFristenMails("2026-10-06", new Date("2026-10-06T06:00:00Z"))).toEqual({ sent: 0 });
    expect(await mail.runDueFristenMails("2026-10-11", new Date("2026-10-11T06:00:00Z"))).toEqual({ sent: 1 });
    expect(sent.at(-1)!.subject).toBe("Frist morgen: Umsatzsteuer-Voranmeldung September 2026");

    // Erledigtes erinnert nicht mehr: Oktober ist gesendet, nur der überfällige September kommt einmal
    await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 10, 'sent', 0, 0, 0, 0, now())`;
    expect(await mail.runDueFristenMails("2026-11-09", new Date("2026-11-09T06:00:00Z"))).toEqual({ sent: 1 });
    expect(sent.at(-1)!.subject).toBe("Frist seit 28 Tagen überfällig: Umsatzsteuer-Voranmeldung September 2026");

    // Ein Fehler des Servers wird protokolliert und beim nächsten Lauf nachgeholt
    failNext = true;
    await expect(mail.runDueFristenMails("2026-12-03", new Date("2026-12-03T06:00:00Z"))).rejects.toThrow(/Authentifizierung/);
    expect(await mail.runDueFristenMails("2026-12-03", new Date("2026-12-03T06:00:00Z"))).toMatchObject({ sent: expect.any(Number) });
    const log = await sql`select ok, error from mail_log order by created_at`;
    expect(log.some((r) => !r.ok && r.error === "Authentifizierung fehlgeschlagen")).toBe(true);
    await expect(sql`delete from mail_log`).rejects.toThrow();
  });

  it("schickt eine Test-Mail und behält das Passwort beim Speichern ohne neues", async () => {
    await expect(mail.sendTestMail(actor)).rejects.toThrow(/kein E-Mail-Zugang/);
    const base = { host: "smtp.example.com", port: 587, secure: false, username: "max", fromAddress: "a@example.com", reminderTo: "b@example.com", remindersEnabled: false, reminderDays: [] };
    await expect(mail.saveMailSettings(actor, base)).rejects.toThrow(/Passwort fehlt/);
    await mail.saveMailSettings(actor, { ...base, password: "geheim" });
    await mail.saveMailSettings(actor, { ...base, port: 2525 });
    const [row] = await sql`select port, ciphertext from mail_settings`;
    expect(row!.port).toBe(2525);
    expect(new TextDecoder().decode(crypto.decrypt(row!.ciphertext))).toBe("geheim");
    expect(await mail.sendTestMail(actor)).toEqual({ ok: true, error: null });
    expect(sent.at(-1)).toMatchObject({ to: "b@example.com", subject: "Haben: Test-Mail" });
    expect(await mail.runDueFristenMails("2026-10-05", new Date("2026-10-05T06:00:00Z"))).toBeNull(); // Erinnerungen aus
    expect((await mail.mailSettingsSummary()) as object).not.toHaveProperty("ciphertext");
  });
});
