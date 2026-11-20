import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { evatrDienst as dienst, evatrFehler as fehler, evatrOk as ok } from "../../test-evatr.ts";

/*
 * USt-IdNrn. der EU-Kunden im Hintergrund neu bestätigen (#1489): Der Lauf fragt jede Nummer aus Rechnungen mit Reverse
 * Charge oder innergemeinschaftlicher Lieferung der letzten 12 Monate, deren letzte Antwort älter als 30 Tage ist, einfach
 * und speichert die Antwort am Kontakt der Rechnung; eine ungültige steht in der Übersicht und einmal in der Erinnerungs-Mail.
 * Keine echte Abfrage: der Dienst ist nachgebaut.
 */

const um = (tag: string, uhrzeit = "08:00") => new Date(`${tag}T${uhrzeit}:00+01:00`);
const HEUTE = "2026-11-20";

describe.skipIf(!testDatabaseUrl)("USt-IdNrn. im Hintergrund beim BZSt bestätigen (Postgres)", () => {
  let sql: postgres.Sql;
  let pruefung: typeof import("./ustid-pruefung.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let mail: typeof import("../mail/mail.ts");
  let erinnerung: typeof import("../finanzamt/fristen-mail.ts");
  const actor = "test-user";
  const ids: Record<string, string> = {};
  const mails: { subject: string; text: string }[] = [];

  async function rechnung(name: string, ustId: string, land: string, issueDate: string, taxTreatment: "reverse_charge" | "regulaer") {
    const contact = await stammdaten.createContact(actor, {
      kundennummer: "",
      name,
      strasse: "Hauptstraße 1",
      plz: "1020",
      ort: "Wien",
      land,
      email: "einkauf@kunde.example",
      ustId,
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: issueDate,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment,
      lines: [{ description: "Beratung", quantity: 1000, unit: "Stk." as const, unitPrice: 100_000, taxRate: taxTreatment === "regulaer" ? 1900 : 0 }],
    });
    await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    return contact.id;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    pruefung = await import("./ustid-pruefung.ts");
    stammdaten = await import("../stammdaten/index.ts");
    invoices = await import("../rechnungen/index.ts");
    mail = await import("../mail/mail.ts");
    erinnerung = await import("../finanzamt/fristen-mail.ts");
    mail.setMailTransportForTests(() => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      return {
        sendMail: async (message: { subject: string; text: string }) => {
          mails.push({ subject: message.subject, text: message.text });
          return transport.sendMail(message);
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>;
    });
    await leeren(sql)`truncate ustid_bestaetigungen, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, mail_log, mail_settings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', 'soll', 'SKR03')`;
    ids.donau = await rechnung("Donaublick GmbH", "ATU12345678", "AT", "2026-08-10", "reverse_charge");
    ids.seine = await rechnung("Seine SARL", "FR12345678901", "FR", "2026-10-01", "reverse_charge");
    // Älter als 12 Monate, und eine Rechnung mit deutscher Umsatzsteuer: beide fragt der Lauf nicht
    ids.alt = await rechnung("Altkunde B.V.", "NL123456789B01", "NL", "2025-11-19", "reverse_charge");
    ids.inland = await rechnung("Kopenhagen ApS", "DK12345678", "DK", "2026-09-15", "regulaer");
  }, 90_000);

  beforeEach(async () => {
    delete (globalThis as { __habenUstIdPruefung?: string }).__habenUstIdPruefung;
    await leeren(sql)`truncate ustid_bestaetigungen`;
  });

  afterEach(async () => {
    delete process.env.HABEN_EVATR;
    await sql`update company set ust_id = 'DE136695976' where id = 1`;
    await sql`update contacts set ust_id = 'ATU12345678' where id = ${ids.donau!}`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("fragt jede betroffene Nummer ohne frische Antwort einfach und speichert die Antwort am Kontakt der Rechnung", async () => {
    // Seine vor fünf Tagen bestätigt, etwa vor dem Festschreiben: frisch, also nicht gefragt
    await stammdaten.bestaetigeNummer(actor, ids.seine!, "FR12345678901", dienst(ok("fr", undefined, "2026-11-15T10:00:00+01:00")).via);
    const { via, anfragen } = dienst(ok("at", undefined, "2026-11-20T08:00:01.5+01:00"));
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE), via)).toEqual({ gefragt: 1, offen: 1, ausfall: null });
    expect(anfragen).toEqual([{ anfragendeUstid: "DE136695976", angefragteUstid: "ATU12345678" }]);
    const [antwort] = await sql`select contact_id, art, status, created_by from ustid_bestaetigungen where angefragte_ustid = 'ATU12345678'`;
    expect(antwort).toEqual({ contact_id: ids.donau, art: "einfach", status: "evatr-0000", created_by: "system:ustid" });
  });

  it("läuft höchstens einmal am Tag und nicht nachts; jede Nummer ist höchstens einmal in 30 Tagen dran", async () => {
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE, "03:00"), dienst().via)).toBeNull();
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE, "22:30"), dienst().via)).toBeNull();
    const erster = dienst(ok("at", undefined, "2026-11-20T08:00:00+01:00"), ok("fr", undefined, "2026-11-20T08:00:02+01:00"));
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE), erster.via)).toMatchObject({ gefragt: 2 });
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE, "15:00"), dienst().via)).toBeNull();
    // Am nächsten Tag und bis 30 Tage danach sind beide Antworten frisch
    expect(await pruefung.runDueUstIdPruefung(um("2026-11-21"), dienst().via)).toEqual({ gefragt: 0, offen: 0, ausfall: null });
    expect(await pruefung.runDueUstIdPruefung(um("2026-12-20", "07:30"), dienst().via)).toEqual({ gefragt: 0, offen: 0, ausfall: null });
    const spaeter = dienst(ok("at2"), ok("fr2"));
    expect(await pruefung.runDueUstIdPruefung(um("2026-12-21"), spaeter.via)).toMatchObject({ gefragt: 2, offen: 2 });
  });

  it("bricht nach einem Ausfall ab; der Lauf am nächsten Tag fragt die übrigen Nummern", async () => {
    const ausfall = dienst(fehler(503, "evatr-1001"), ok("nie"));
    const ergebnis = await pruefung.runDueUstIdPruefung(um(HEUTE), ausfall.via);
    expect(ergebnis).toMatchObject({ gefragt: 1, offen: 2, ausfall: expect.stringContaining("evatr-1001") });
    expect(ausfall.anfragen).toHaveLength(1);
    const naechster = dienst(ok("a", undefined, "2026-11-21T08:00:00+01:00"), ok("b", undefined, "2026-11-21T08:00:01+01:00"));
    expect(await pruefung.runDueUstIdPruefung(um("2026-11-21"), naechster.via)).toEqual({ gefragt: 2, offen: 2, ausfall: null });
  });

  // Eine falsche Prüfziffer beantwortet das BZSt mit HTTP 400 evatr-0005, mit id und Zeitpunkt (Testabfrage 2026-11-20, #1578)
  it("fragt eine Nummer, die das BZSt syntaktisch falsch nennt, nicht jeden Tag neu, sondern nach 30 Tagen", async () => {
    const erster = dienst(fehler(400, "evatr-0005", "2026-11-20T08:00:00+01:00"), ok("at", undefined, "2026-11-20T08:00:01+01:00"));
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE), erster.via)).toEqual({ gefragt: 2, offen: 2, ausfall: null });
    const zweiter = dienst();
    expect(await pruefung.runDueUstIdPruefung(um("2026-11-21"), zweiter.via)).toEqual({ gefragt: 0, offen: 0, ausfall: null });
    expect(zweiter.anfragen).toEqual([]);
    const spaeter = dienst(fehler(400, "evatr-0005"), ok("at2"));
    expect(await pruefung.runDueUstIdPruefung(um("2026-12-21"), spaeter.via)).toMatchObject({ gefragt: 2, offen: 2 });
  });

  it("nennt eine Nummer, die das BZSt syntaktisch falsch nennt, in der Übersicht", async () => {
    await pruefung.runDueUstIdPruefung(um(HEUTE), dienst(fehler(400, "evatr-0005", "2026-11-20T08:00:00+01:00"), ok("at")).via);
    expect(await pruefung.ungueltigeUstIdNrn(HEUTE)).toEqual([
      expect.objectContaining({ contactId: ids.seine, nummer: "FR12345678901", meldung: "Das BZSt hält die USt-IdNr. für syntaktisch falsch" }),
    ]);
  });

  it("fragt eine Nummer aus Rechnungen nicht mehr, wenn der Kontakt inzwischen eine andere hat", async () => {
    // Für die alte Rechnung hilft eine Bestätigung nach dem Umsatz nicht (UStAE 6a.8 Abs. 6), und angezeigt würde sie nirgends
    await sql`update contacts set ust_id = 'ATU87654321' where id = ${ids.donau!}`;
    const { via, anfragen } = dienst(ok("fr"));
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE), via)).toEqual({ gefragt: 1, offen: 1, ausfall: null });
    expect(anfragen.map((a) => a.angefragteUstid)).toEqual(["FR12345678901"]);
  });

  it("abgeschaltet oder ohne eigene USt-IdNr. läuft nichts", async () => {
    process.env.HABEN_EVATR = "off";
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE), dienst().via)).toBeNull();
    delete process.env.HABEN_EVATR;
    await sql`update company set ust_id = '' where id = 1`;
    expect(await pruefung.runDueUstIdPruefung(um(HEUTE), dienst().via)).toBeNull();
    expect(await sql`select 1 from ustid_bestaetigungen`).toHaveLength(0);
  });

  it("nennt eine ungültige Nummer mit Kontakt, bis eine gültige Antwort kommt oder der Kontakt eine andere Nummer hat", async () => {
    expect(await pruefung.ungueltigeUstIdNrn(HEUTE)).toEqual([]);
    // Die jüngste Rechnung zuerst: Seine, dann Donaublick
    await pruefung.runDueUstIdPruefung(um(HEUTE), dienst(ok("fr"), fehler(200, "evatr-2006", "2026-11-20T08:00:00+01:00")).via);
    const [ungueltig] = await pruefung.ungueltigeUstIdNrn(HEUTE);
    expect(ungueltig).toMatchObject({
      contactId: ids.donau,
      kontakt: "Donaublick GmbH",
      nummer: "ATU12345678",
      meldung: expect.stringMatching(/^Nicht mehr gültig/),
    });
    expect(await pruefung.ungueltigeUstIdNrn(HEUTE)).toHaveLength(1);

    await sql`update contacts set ust_id = 'ATU87654321' where id = ${ids.donau!}`;
    expect(await pruefung.ungueltigeUstIdNrn(HEUTE)).toEqual([]);
    await sql`update contacts set ust_id = 'ATU12345678' where id = ${ids.donau!}`;
    await stammdaten.bestaetigeNummer(actor, ids.donau!, "ATU12345678", dienst(ok("wieder")).via);
    expect(await pruefung.ungueltigeUstIdNrn(HEUTE)).toEqual([]);
  });

  it("steht einmal je Antwort in der Erinnerungs-Mail, mit Link auf den Kontakt, auch ohne fällige Frist", async () => {
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
    await pruefung.runDueUstIdPruefung(um(HEUTE), dienst(ok("fr"), fehler(404, "evatr-2001", "2026-11-20T08:00:00+01:00")).via);
    await erinnerung.runDueFristenMails(HEUTE, um(HEUTE));
    expect(mails.at(-1)!.text).toContain("USt-IdNr. laut BZSt nicht gültig");
    expect(mails.at(-1)!.text).toMatch(
      new RegExp(`- ATU12345678 \\(Donaublick GmbH\\): Nicht vergeben, Antwort vom 20\\.11\\.2026\n  https?://[^/]+/kontakte/${ids.donau}`),
    );
    const gesendet = mails.length;

    // Dieselbe Antwort erinnert nicht noch einmal; eine neue ungültige Antwort schon, auch ohne Frist
    expect(await erinnerung.runDueFristenMails(HEUTE, um(HEUTE, "09:00"))).toEqual({ sent: 0 });
    expect(mails).toHaveLength(gesendet);
    await stammdaten.bestaetigeNummer(actor, ids.donau!, "ATU12345678", dienst(fehler(404, "evatr-2001", "2026-11-20T09:30:00+01:00")).via);
    await erinnerung.runDueFristenMails(HEUTE, um(HEUTE, "10:00"));
    expect(mails).toHaveLength(gesendet + 1);
    expect(mails.at(-1)!.subject).toBe("USt-IdNr. von Donaublick GmbH laut BZSt nicht gültig");
  });
});
